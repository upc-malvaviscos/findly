"""Doble secuencia vertical de inscripción y procesamiento de fotografías."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


BASE = Path(__file__).resolve().parents[1]
OUTPUT = BASE / "img" / "secuencia-matching.png"
FONT = BASE / "diagramas" / "fonts" / "LiberationSans-Regular.ttf"

WIDTH, HEIGHT = 1280, 1780
INK = "#18324b"
BLUE = "#31547d"
PALE = "#edf4fb"
AMBER = "#fff4e7"
MUTED = "#637589"
WHITE = "#ffffff"


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT), size)


image = Image.new("RGB", (WIDTH, HEIGHT), WHITE)
draw = ImageDraw.Draw(image)
draw.text((WIDTH // 2, 22), "Inscripción y matching de fotografías", fill=INK, font=font(34), anchor="mt")
draw.text(
    (WIDTH // 2, 68),
    "Dos secuencias relacionadas · cargas directas a S3 · persistencia no atómica",
    fill=MUTED,
    font=font(22),
    anchor="mt",
)


def panel(top: int, bottom: int, title: str, participants: list[tuple[int, str]]) -> None:
    draw.rounded_rectangle((30, top, WIDTH - 30, bottom), radius=18, fill=WHITE, outline="#9aaabd", width=2)
    draw.text((WIDTH // 2, top + 16), title, fill=INK, font=font(25), anchor="mt")
    header_y = top + 65
    for x, label in participants:
        box = (x - 135, header_y, x + 135, header_y + 82)
        draw.rounded_rectangle(box, radius=12, fill=PALE, outline=BLUE, width=3)
        draw.multiline_text(
            (x, header_y + 41),
            label,
            fill=INK,
            font=font(22),
            anchor="mm",
            align="center",
            spacing=3,
        )
        y_end = bottom - 30
        draw.line((x, header_y + 82, x, y_end), fill="#9aaabd", width=2)
        for y in range(header_y + 94, y_end, 22):
            draw.line((x, y, x, min(y + 10, y_end)), fill="#9aaabd", width=2)


def message(y: int, x1: int, x2: int, label: str, *, response: bool = False) -> None:
    sign = 1 if x2 > x1 else -1
    color = MUTED if response else BLUE
    if response:
        for start in range(x1, x2, sign * 18):
            end = start + sign * 9
            if (sign > 0 and end <= x2) or (sign < 0 and end >= x2):
                draw.line((start, y, end, y), fill=color, width=2)
    else:
        draw.line((x1, y, x2, y), fill=color, width=3)
    draw.polygon([(x2, y), (x2 - sign * 14, y - 8), (x2 - sign * 14, y + 8)], fill=color)
    draw.multiline_text(
        ((x1 + x2) // 2, y - 23),
        label,
        fill=INK,
        font=font(22),
        anchor="mm",
        align="center",
        spacing=2,
    )


# Panel 1 omite Rekognition y DynamoDB como lifelines para dejar clara la ruta
# browser → API → S3 → SelfieIndexer. Sus llamadas se anotan en el propio panel.
p1 = [(160, "Navegador"), (480, "API"), (800, "S3 uploads"), (1120, "SelfieIndexer\nLambda")]
panel(120, 690, "1 · Inscripción de una persona", p1)
message(315, 160, 480, "1. inscripción\ncon consentimiento")
message(385, 480, 160, "2. URL prefirmada\n+ registrationId", response=True)
message(455, 160, 800, "3. PUT selfie\ndirecto a S3")
message(525, 800, 1120, "4. evento S3\n*.selfie.jpg")
draw.rounded_rectangle((70, 555, WIDTH - 70, 660), radius=12, fill="#f8fafc", outline="#b8c5d3", width=2)
draw.multiline_text(
    (WIDTH // 2, 607),
    "SelfieIndexer llama IndexFaces (S3Object) y persiste faceId + ENROLLED en DynamoDB.\n"
    "Tras ENROLLED, envía una tarea a la cola SQS de backfill.",
    fill=INK,
    font=font(22),
    anchor="mm",
    align="center",
    spacing=5,
)

# Panel 2 abstrae dos pares separados: SQS fotos→PhotoMatcher y
# SQS backfill→RegistrationBackfill. Rekognition y DynamoDB mantienen lifelines.
p2 = [(255, "Colas SQS +\nworkers Lambda"), (650, "Rekognition"), (1045, "DynamoDB")]
panel(730, 1535, "2 · Matching de fotos y backfill", p2)
draw.rounded_rectangle((70, 885, WIDTH - 70, 935), radius=8, fill=WHITE, outline="#d6dee7", width=1)
draw.text(
    (WIDTH // 2, 910),
    "Dos colas y dos workers: fotos→PhotoMatcher; backfill→RegistrationBackfill",
    fill=MUTED,
    font=font(22),
    anchor="mm",
)
message(1000, 255, 650, "PhotoMatcher: IndexFaces +\nSearchFaces (foto en S3)")
message(1060, 650, 255, "faceId de la foto + resultados", response=True)
message(1120, 255, 1045, "Query: resolver faceId\na inscripción ENROLLED")
message(1170, 1045, 255, "inscripción asociada", response=True)
message(1220, 255, 1045, "TransactWrite: match + espejo\ncon condiciones de vigencia")
message(1280, 255, 650, "finally: DeleteFaces\nde las caras temporales")
message(1360, 255, 650, "RegistrationBackfill: IndexFaces +\nSearchFaces sobre fotos previas")
message(1420, 650, 255, "resultados de búsqueda", response=True)
message(1480, 255, 1045, "reconcilia y guarda\ncoincidencias condicionales")

draw.rounded_rectangle((55, 1570, WIDTH - 55, 1750), radius=14, fill=AMBER, outline="#b36b00", width=2)
draw.text((WIDTH // 2, 1595), "Convergencia y límites", fill="#814b00", font=font(23), anchor="mt")
draw.multiline_text(
    (WIDTH // 2, 1672),
    "Foto antes de ENROLLED: PhotoMatcher puede no encontrar la inscripción; el backfill la vuelve a procesar.\n"
    "Selfie antes de las fotos: PhotoMatcher busca la cara al llegar cada objeto.\n"
    "Rekognition y DynamoDB son llamadas separadas; hay condiciones y reconciliación, no transacción distribuida.",
    fill=INK,
    font=font(22),
    anchor="mm",
    align="center",
    spacing=5,
)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
image.save(OUTPUT, optimize=True)
