"""Portada abstracta de Findly (img/portada_abstracta.svg y .png).

Idea: una identidad (naranja, a la izquierda) se busca entre muchas fotos;
solo una coincide (resaltada) y el resto se disuelve hacia la derecha
(datos temporales, retención limitada).

Uso: python diagramas/portada_abstracta.py   (PNG requiere: pip install cairosvg)
"""
import random

random.seed(11)
W, H = 1600, 1100
NAVY = "#2b4c7e"
ORANGE = "#f59e0b"
GREEN = "#22a06b"

COLS, ROWS = 10, 6
CELL, PITCH = 100, 112
X0 = 400
Y0 = (H - (ROWS * PITCH - (PITCH - CELL))) / 2   # centrada en vertical
HL_COL, HL_ROW = 3, 2                            # celda resaltada

parts = []
add = parts.append
add(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
    f'viewBox="0 0 {W} {H}" width="{W}" height="{H}">')
add(f"""<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#16294a"/>
    <stop offset="1" stop-color="#4a78c2"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="{ORANGE}" stop-opacity="0.45"/>
    <stop offset="1" stop-color="{ORANGE}" stop-opacity="0"/>
  </radialGradient>
  <g id="person">
    <circle cx="0" cy="-12" r="15"/>
    <path d="M -28 30 L -28 18 C -28 2 -14 -2 0 -2 C 14 -2 28 2 28 18 L 28 30 Z"/>
  </g>
</defs>""")
add(f'<rect width="{W}" height="{H}" fill="url(#bg)"/>')


def cell_xy(c, r):
    return X0 + c * PITCH, Y0 + r * PITCH


hx, hy = cell_xy(HL_COL, HL_ROW)
hcx, hcy = hx + CELL / 2, hy + CELL / 2

# Halo y anillos alrededor de la coincidencia (detrás de la rejilla)
add(f'<circle cx="{hcx}" cy="{hcy}" r="260" fill="url(#glow)"/>')
for r_, o in [(95, 0.5), (150, 0.3), (215, 0.16)]:
    add(f'<circle cx="{hcx}" cy="{hcy}" r="{r_}" fill="none" stroke="{ORANGE}" '
        f'stroke-width="3" opacity="{o}"/>')

# Rejilla de fotos que se disuelve hacia la derecha
for r in range(ROWS):
    for c in range(COLS):
        if (c, r) == (HL_COL, HL_ROW):
            continue
        x, y = cell_xy(c, r)
        fade = 1 - c / (COLS - 1)                      # 1 a la izquierda, 0 a la derecha
        # a la derecha desaparecen más celdas (efecto de disolución)
        if random.random() > 0.35 + 0.65 * fade:
            continue
        o = 0.08 + 0.42 * fade * random.uniform(0.6, 1.0)
        add(f'<rect x="{x}" y="{y}" width="{CELL}" height="{CELL}" rx="20" '
            f'fill="white" fill-opacity="{o * 0.35:.3f}" stroke="white" '
            f'stroke-opacity="{o:.3f}" stroke-width="2.5"/>')
        add(f'<use xlink:href="#person" fill="white" fill-opacity="{o:.3f}" '
            f'transform="translate({x + CELL/2} {y + CELL/2 + 6}) scale(1.05)"/>')

# Celda resaltada (la coincidencia)
add(f'<rect x="{hx}" y="{hy}" width="{CELL}" height="{CELL}" rx="20" fill="{ORANGE}"/>')
add(f'<use xlink:href="#person" fill="white" '
    f'transform="translate({hcx} {hcy + 6}) scale(1.05)"/>')


def brackets(cx, cy, size, length, color="white", width=7):
    h = size / 2
    x0, x1, y0, y1 = cx - h, cx + h, cy - h, cy + h
    d = (f"M {x0} {y0 + length} V {y0} H {x0 + length} "
         f"M {x1 - length} {y0} H {x1} V {y0 + length} "
         f"M {x1} {y1 - length} V {y1} H {x1 - length} "
         f"M {x0 + length} {y1} H {x0} V {y1 - length}")
    return (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" '
            f'stroke-linecap="round" stroke-linejoin="round"/>')


add(brackets(hcx, hcy, CELL + 34, 26))
bx, by = hx + CELL + 6, hy - 6
add(f'<circle cx="{bx}" cy="{by}" r="22" fill="{GREEN}" stroke="white" stroke-width="4"/>'
    f'<path d="M {bx - 9} {by + 1} L {bx - 2} {by + 8} L {bx + 10} {by - 7}" fill="none" '
    f'stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>')

# Identidad (selfie) a la izquierda
ix, iy = 190, hcy
for r_, o in [(100, 0.18), (140, 0.1)]:
    add(f'<circle cx="{ix}" cy="{iy}" r="{r_}" fill="none" stroke="{ORANGE}" '
        f'stroke-width="3" opacity="{o + 0.12}"/>')
add(f'<circle cx="{ix}" cy="{iy}" r="64" fill="{ORANGE}"/>')
add(f'<clipPath id="idclip"><circle cx="{ix}" cy="{iy}" r="64"/></clipPath>')
add('<g clip-path="url(#idclip)">')
add(f'<use xlink:href="#person" fill="white" transform="translate({ix} {iy + 8}) scale(1.7)"/>')
add('</g>')

# Línea de búsqueda: de la identidad a la coincidencia
add(f'<line x1="{ix + 70}" y1="{iy}" x2="{hx - 22}" y2="{hcy}" stroke="{ORANGE}" '
    f'stroke-width="5" stroke-dasharray="4 14" stroke-linecap="round"/>')

# Luces de fondo muy sutiles
for _ in range(10):
    x, y = random.randint(40, W - 40), random.randint(30, 130)
    add(f'<circle cx="{x}" cy="{y}" r="{random.randint(18, 60)}" fill="white" '
        f'opacity="{random.choice([0.05, 0.08])}"/>')

add('</svg>')
svg = "\n".join(parts)

with open("img/portada_abstracta.svg", "w", encoding="utf-8") as f:
    f.write(svg)

try:
    import cairosvg
    cairosvg.svg2png(bytestring=svg.encode("utf-8"),
                     write_to="img/portada_abstracta.png", scale=2)
    print("OK: img/portada_abstracta.svg e img/portada_abstracta.png")
except ImportError:
    print("Solo SVG generado. Instala cairosvg para el PNG: pip install cairosvg")
