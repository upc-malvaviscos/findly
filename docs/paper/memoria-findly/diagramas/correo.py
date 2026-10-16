"""Regenerate the focused email architecture with a bundled, portable font."""

from functools import lru_cache
from math import atan2, cos, sin
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
image = Image.new("RGB", (2200, 1400), "white")
draw = ImageDraw.Draw(image)
INK = "#17324D"
BLUE = "#23658A"
ORANGE = "#A8540B"
PURPLE = "#6F4896"


@lru_cache
def font_for(size):
    return ImageFont.truetype(str(ROOT / "diagramas/fonts/LiberationSans-Regular.ttf"), size=size)


def text(center, label, size=40, fill=INK):
    font = font_for(size)
    draw.text(center, label, font=font, fill=fill, anchor="mm")


def node(x, y, title, lines, color=BLUE, width=360, height=220):
    draw.rounded_rectangle(
        (x, y, x + width, y + height), radius=18, fill="#F8FAFC", outline=color, width=4
    )
    text((x + width / 2, y + 52), title, 48, color)
    for index, line in enumerate(lines):
        font = font_for(42)
        assert draw.textlength(line, font=font) <= width - 28, "Figure label overflow"
        text((x + width / 2, y + 112 + index * 48), line, 42)


def arrow(points, color=INK, width=5, both=False):
    draw.line(points, fill=color, width=width, joint="curve")

    def head(before, end):
        angle = atan2(end[1] - before[1], end[0] - before[0])
        draw.polygon(
            [
                end,
                (end[0] - 19 * cos(angle - 0.48), end[1] - 19 * sin(angle - 0.48)),
                (end[0] - 19 * cos(angle + 0.48), end[1] - 19 * sin(angle + 0.48)),
            ],
            fill=color,
        )

    head(points[-2], points[-1])
    if both:
        head(points[1], points[0])


def label(center, value, size=38, color=INK):
    font = font_for(size)
    length = draw.textlength(value, font=font)
    x, y = center
    draw.rectangle((x - length / 2 - 12, y - 25, x + length / 2 + 12, y + 25), fill="white")
    text(center, value, size, color)


text((1100, 72), "Envío manual de galerías", 76)
text((1100, 157), "Backend de producción · eu-west-1 · ADR-019", 40)

node(80, 280, "Organizador", ["Confirma envío"], INK)
node(500, 280, "API HTTP", ["JWT Cognito", "2 Lambdas"], PURPLE)
node(920, 280, "SQS FIFO", ["Operación UUID"], ORANGE)
node(1340, 280, "Worker SES", ["Datos + fotos S3", "1 Lambda"], PURPLE)
node(1760, 280, "Amazon SES", ["Identidad / DKIM", "MAIL FROM"], ORANGE)

for x in (440, 860, 1280, 1700):
    arrow([(x, 390), (x + 60, 390)])

node(920, 570, "DLQ FIFO", ["5 recepciones"], ORANGE, height=170)
arrow([(1100, 500), (1100, 570)], ORANGE)

node(80, 820, "Asistente", ["Buzón y enlace"], INK)
node(500, 820, "DynamoDB", ["Estados / hashes"], BLUE)
node(920, 820, "Feedback", ["Contadores", "1 Lambda"], PURPLE)
node(1340, 820, "SQS feedback", ["Cola + DLQ"], ORANGE)
node(1760, 820, "Amazon SNS", ["Rebotes / quejas"], ORANGE)

arrow([(680, 500), (680, 820)], BLUE, both=True)
label((680, 665), "Progreso", color=BLUE)
arrow([(1520, 500), (1520, 780), (800, 780), (800, 820)], BLUE, both=True)
label((1110, 780), "Revalidación y capacidades", color=BLUE)

arrow([(1940, 500), (1940, 820)], ORANGE)
label((1940, 660), "Rebote / queja", color=ORANGE)
for x in (1760, 1340, 920):
    arrow([(x, 930), (x - 60, 930)], ORANGE)

arrow([(2120, 390), (2160, 390), (2160, 1140), (260, 1140), (260, 1040)], BLUE)
label((1510, 1140), "Correo individual con enlace de galería", color=BLUE)

draw.rounded_rectangle((80, 1210, 2120, 1370), radius=14, fill="#EEF3F8")
text((1100, 1242), "DLQ: recuperar la misma UUID · Inciertos: sin reenvío automático", 38)
text((1100, 1290), "Capacidades: sólo hashes · Sin correo por matching", 38)
text((1100, 1338), "Aceptación SES no equivale a recepción", 38)

output = ROOT / "img/correo.png"
image.save(output, dpi=(300, 300), optimize=True)
print(f"Generated {output.name}: {image.width} x {image.height}")
