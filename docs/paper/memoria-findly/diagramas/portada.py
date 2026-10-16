"""Genera la ilustración de portada (img/portada.svg y img/portada.png).

Ilustración original: selfie -> búsqueda -> galería con coincidencias marcadas
y un candado + reloj para la galería privada y temporal.

Uso: python diagramas/portada.py   (PNG requiere: pip install cairosvg)
"""
import random

random.seed(7)
W, H = 1600, 1100
NAVY = "#2b4c7e"
ORANGE = "#f59e0b"
GREEN = "#22a06b"

parts = []
add = parts.append

add(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
    f'viewBox="0 0 {W} {H}" width="{W}" height="{H}">')
add("""<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#1b3358"/>
    <stop offset="1" stop-color="#4a78c2"/>
  </linearGradient>
  <g id="person">
    <circle cx="0" cy="-20" r="27"/>
    <path d="M -55 90 L -55 40 C -55 8 -30 0 0 0 C 30 0 55 8 55 40 L 55 90 Z"/>
  </g>
</defs>""")
add(f'<rect width="{W}" height="{H}" fill="url(#bg)"/>')

# Luces de evento (bokeh)
for _ in range(16):
    x, y = random.randint(40, W - 40), random.randint(30, 230)
    r = random.randint(22, 80)
    o = random.choice([0.07, 0.1, 0.14])
    add(f'<circle cx="{x}" cy="{y}" r="{r}" fill="white" opacity="{o}"/>')


def brackets(cx, cy, size, length, color=ORANGE, width=9):
    """Cuatro esquinas alrededor de un rostro."""
    h = size / 2
    x0, x1, y0, y1 = cx - h, cx + h, cy - h, cy + h
    d = (f"M {x0} {y0 + length} V {y0} H {x0 + length} "
         f"M {x1 - length} {y0} H {x1} V {y0 + length} "
         f"M {x1} {y1 - length} V {y1} H {x1 - length} "
         f"M {x0 + length} {y1} H {x0} V {y1 - length}")
    return (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" '
            f'stroke-linecap="round" stroke-linejoin="round"/>')


def check_badge(cx, cy, r=30):
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{GREEN}" stroke="white" stroke-width="5"/>'
            f'<path d="M {cx - r*0.42} {cy + 1} L {cx - r*0.1} {cy + r*0.34} L {cx + r*0.46} {cy - r*0.32}" '
            f'fill="none" stroke="white" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>')


# --- Móvil con la selfie -----------------------------------------------
px, py, pw, ph = 110, 250, 380, 600
add(f'<rect x="{px}" y="{py}" width="{pw}" height="{ph}" rx="52" fill="white"/>')
add(f'<rect x="{px + 20}" y="{py + 30}" width="{pw - 40}" height="{ph - 60}" rx="34" fill="#eef3fb"/>')
add(f'<rect x="{px + pw/2 - 40}" y="{py + 10}" width="80" height="10" rx="5" fill="#c9d4e6"/>')
scx, scy = px + pw / 2, py + 400
add(f'<clipPath id="screen"><rect x="{px + 20}" y="{py + 30}" width="{pw - 40}" '
    f'height="{ph - 60}" rx="34"/></clipPath>')
add('<g clip-path="url(#screen)">')
add(f'<use xlink:href="#person" fill="{NAVY}" transform="translate({scx} {scy}) scale(2.4)"/>')
add('</g>')
add(brackets(scx, scy - 48, 150, 38, width=10))
add(check_badge(px + pw - 78, py + 92, r=32))

# --- Lupa (búsqueda) ----------------------------------------------------
mx, my = 565, 520
add(f'<circle cx="{mx}" cy="{my}" r="34" fill="none" stroke="white" stroke-width="12"/>')
add(f'<line x1="{mx + 25}" y1="{my + 25}" x2="{mx + 58}" y2="{my + 58}" stroke="white" '
    f'stroke-width="14" stroke-linecap="round"/>')

# --- Galería de fotos ----------------------------------------------------
colors = ["#dbe7fb", "#fde7cf", "#dff3e4", "#efe1f7", "#fbe0e0", "#e0f1f5"]
tones = ["#5b7db3", "#e08a3c", "#4c9a74", "#8a62b5", "#c75a5a", "#3f8fa6"]
matches = {1, 3}
xs, ys, cs = [650, 940, 1230], [250, 560], 260
for i in range(6):
    col, row = i % 3, i // 3
    x, y = xs[col], ys[row]
    cid = f"c{i}"
    add(f'<clipPath id="{cid}"><rect x="{x}" y="{y}" width="{cs}" height="{cs}" rx="28"/></clipPath>')
    add(f'<rect x="{x}" y="{y}" width="{cs}" height="{cs}" rx="28" fill="{colors[i]}"/>')
    add(f'<g clip-path="url(#{cid})">')
    add(f'<use xlink:href="#person" fill="{tones[i]}" '
        f'transform="translate({x + 78} {y + 175}) scale(0.95)"/>')
    add(f'<use xlink:href="#person" fill="{tones[(i + 2) % 6]}" opacity="0.9" '
        f'transform="translate({x + 190} {y + 195}) scale(0.78)"/>')
    add('</g>')
    if i in matches:
        add(brackets(x + 78, y + 156, 84, 22, width=7))
        add(check_badge(x + cs - 36, y + 36, r=26))

# --- Candado + reloj: galería privada y temporal -------------------------
add(f'<rect x="590" y="900" width="420" height="96" rx="48" fill="white" opacity="0.96"/>')
# candado
lx, ly = 668, 950
add(f'<rect x="{lx - 24}" y="{ly - 4}" width="48" height="38" rx="7" fill="{NAVY}"/>')
add(f'<path d="M {lx - 14} {ly - 4} V {ly - 16} a 14 14 0 0 1 28 0 V {ly - 4}" fill="none" '
    f'stroke="{NAVY}" stroke-width="8" stroke-linecap="round"/>')
add(f'<circle cx="{lx}" cy="{ly + 15}" r="5" fill="white"/>')
# separador
add(f'<line x1="800" y1="920" x2="800" y2="976" stroke="#c9d4e6" stroke-width="4"/>')
# reloj
rx_, ry_ = 932, 948
add(f'<circle cx="{rx_}" cy="{ry_}" r="30" fill="none" stroke="{NAVY}" stroke-width="8"/>')
add(f'<path d="M {rx_} {ry_ - 16} V {ry_} L {rx_ + 13} {ry_ + 8}" fill="none" stroke="{NAVY}" '
    f'stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>')

add('</svg>')
svg = "\n".join(parts)

with open("img/portada.svg", "w", encoding="utf-8") as f:
    f.write(svg)

try:
    import cairosvg
    cairosvg.svg2png(bytestring=svg.encode("utf-8"), write_to="img/portada.png", scale=2)
    print("OK: img/portada.svg e img/portada.png")
except ImportError:
    print("Solo SVG generado. Instala cairosvg para el PNG: pip install cairosvg")
