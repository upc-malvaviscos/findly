# Memoria final — Findly (Postgrado UPC)

Esta carpeta contiene la memoria final del proyecto en un único documento
[Pandoc](https://pandoc.org/): [`memoria-postgrado.md`](memoria-postgrado.md).
Los cuatro integrantes del equipo pueden editarlo directamente: es texto
plano, se versiona con Git como el resto del repositorio, y se compila a PDF
(o Word) con un único comando.

No es una copia ni un resumen de `docs/paper/00-11*.md` ni de las specs: se
alimenta de ese contenido, de `docs/adr/` y de `docs/evidence/`, pero se
escribe en prosa propia, sin citar los nombres de esos ficheros internos. Es
el documento pensado para entregarse, no la documentación de trabajo del
repositorio.

## 1. Instalar las herramientas (una vez por persona)

### Compilación reproducible con Docker (recomendada)

Con Node.js 24, `make` y Docker activos, desde la raíz del repositorio:

```sh
npm run paper:pdf
```

No requiere `npm ci`, Python ni una instalación local de LaTeX. Genera
`docs/paper/memoria-findly/memoria.pdf` utilizando el Makefile y las imágenes
versionadas. `pdf-toolchain.json` fija por digest el contenedor oficial con
Pandoc, pandoc-crossref y XeLaTeX; la plataforma es Linux AMD64, emulada en
hosts ARM. La primera ejecución descarga la imagen y necesita acceso al
registro Docker; la conversión se ejecuta sin red. Para actualizar las
herramientas, cambia el digest mediante PR y revisa nuevamente el PDF completo.

### Herramientas nativas (alternativa)

Necesitas cuatro cosas: Pandoc, un motor LaTeX (XeLaTeX), el filtro
`pandoc-crossref` y, sólo si vas a tocar diagramas, Python.

### macOS (Homebrew)

```sh
brew install pandoc pandoc-crossref graphviz
brew install --cask mactex-no-gui   # o: brew install basictex (más ligero)
```

Si instalas `basictex`, puede que falten paquetes LaTeX la primera vez que
compiles (por ejemplo `fancyhdr`). El propio error de `xelatex` te dice qué
paquete falta; se instala con:

```sh
sudo tlmgr update --self
sudo tlmgr install fancyhdr
```

### Linux (Debian/Ubuntu)

```sh
sudo apt install pandoc texlive-xetex texlive-latex-extra graphviz
# pandoc-crossref no siempre está en apt: instálalo desde
# https://github.com/lierdakil/pandoc-crossref/releases
```

### Windows

Instala [Pandoc](https://pandoc.org/installing.html), una distribución LaTeX
con XeLaTeX (p. ej. [MiKTeX](https://miktex.org/)),
[Graphviz](https://graphviz.org/download/) y
[pandoc-crossref](https://github.com/lierdakil/pandoc-crossref/releases)
(añade el `.exe` al `PATH`).

### Python (sólo para regenerar diagramas)

Se requiere Python 3.10 o posterior. No necesitas tocar esto si sólo vas a escribir texto. Hace
falta únicamente para ejecutar los scripts de `diagramas/`:

```sh
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

El `Makefile` ya hace esto por ti con `make diagrams` (ver abajo).
Si tu comando `python3` apunta a una versión anterior, selecciona una compatible,
por ejemplo `make diagrams PYTHON=python3.12`. La figura de correo se genera con
Pillow y Liberation Sans incluida bajo SIL Open Font License (licencia en
`diagramas/fonts/LICENSE.txt`), sin depender de tipografías del sistema.

## 2. Compilar la memoria

```sh
make diagrams   # regenera las imágenes desde diagramas/*.py y *.dot
make pdf        # genera memoria.pdf
make docx       # genera memoria.docx (para revisar con control de cambios)
```

Si prefieres no usar `make`, el comando equivalente es:

```sh
pandoc memoria-postgrado.md -o memoria.pdf --pdf-engine=xelatex \
  --filter pandoc-crossref --include-before-body=portada.tex
```

**Importante**: `--include-before-body=portada.tex` tiene que ir como flag de
línea de comandos, no como clave del YAML del `.md` — si se pone sólo en el
YAML, Pandoc no inserta la portada y el documento empieza directamente en el
índice. El `Makefile` ya lo hace bien; si compilas a mano, no se te olvide.

`memoria.pdf`, `memoria.docx` y `.venv/` **no se versionan** (están en
`.gitignore`): el PDF se puede generar en local o descargar de una release.
Lo que sí se versiona son el
`.md` fuente, los scripts de `diagramas/` y las imágenes ya generadas en
`img/`, para que alguien sin Python/Graphviz instalados pueda compilar igual
el PDF.

## 3. Cómo añadir contenido

### Texto

Edita directamente `memoria-postgrado.md`. Cada capítulo es un encabezado de
nivel 1 (`# Introducción`, `# Implementación de la solución`...); Pandoc los
numera automáticamente (`numbersections: true` en el YAML), así que no hace
falta escribir "1.", "2." a mano.

Antes de escribir una sección, lee lo que ya existe sobre ese tema en
`docs/paper/00-11*.md` (memoria capítulo a capítulo del repositorio) y en
`docs/adr/` y `docs/evidence/`: son la fuente de la que te alimentas, para no
inventar ni repetir trabajo de investigación ya hecho. Lo que cambia es cómo
lo escribes aquí: reescribe ese contenido en prosa propia, continua y en
español, sin frases como "ver capítulo X" ni enlaces a
`docs/paper/0X-*.md` — este documento no remite al lector a otros ficheros
del repositorio para entenderse, tiene que leerse solo. Cuando una afirmación
concreta se beneficie de tener detrás algo verificable (una cifra, un
resultado de prueba, una decisión de arquitectura), cita `docs/evidence/` o
`docs/adr/` (ver más abajo); no cites `docs/paper/0X-*.md`, aunque sea de ahí
de donde partiste.

### Una imagen o captura de pantalla

1. Guarda el fichero en `img/` (PNG o JPG; evita capturas enormes sin
   comprimir).
2. Insértala donde corresponda:

   ```markdown
   ![Pie de la imagen](img/mi-captura.png){#fig:mi-captura}
   ```

3. Para referenciarla desde el texto, usa `@fig:mi-captura` — `pandoc-crossref`
   la numera sola ("Ilustración 3") y mantiene el número correcto aunque
   insertes otra imagen antes.

### Diagramas de arquitectura y flujo

La carpeta separa los niveles para que cada figura sea legible en una página
A4 y no mezcle contexto, software, infraestructura y operación:

- [`diagramas/contexto-c4.dot`](diagramas/contexto-c4.dot) y
  [`diagramas/contenedores-c4.dot`](diagramas/contenedores-c4.dot) describen
  el sistema con semántica C4. «Contenedor» nombra una unidad de software
  ejecutable o almacenable; abarca unidades de ejecución y almacenamiento, con independencia de su empaquetado.
- [`diagramas/arquitectura.dot`](diagramas/arquitectura.dot) usa Graphviz para
  detallar la ingesta y el matching. Representa el bucket privado único de
  cargas y sus dos notificaciones por sufijo: selfies a SelfieIndexer y fotos
  a SQS, DLQ y PhotoMatcher. Las URL prefirmadas permiten el PUT del navegador
  a S3; la API las emite, no transporta los ficheros.
- [`diagramas/despliegue.dot`](diagramas/despliegue.dot) distingue la región
  de aplicación `eu-west-1`, CloudFront global y ACM `us-east-1` sólo si se
  configura un dominio propio.
- [`diagramas/secuencia-matching.py`](diagramas/secuencia-matching.py)
  ilustra ambas órdenes de llegada. El backfill se encola tras `ENROLLED` y
  reconcilia fotos previas; DynamoDB y Rekognition son sistemas separados y
  no forman una transacción atómica.
- [`diagramas/workflow-pr.dot`](diagramas/workflow-pr.dot),
  [`diagramas/workflow-deploy.dot`](diagramas/workflow-deploy.dot) y
  [`diagramas/workflow-pdf.dot`](diagramas/workflow-pdf.dot) separan las
  pruebas y destrucción del entorno efímero de PR, el despliegue persistente
  manual y la publicación de PDF tras integración/callback. La cola estándar
  puede reemplazar una ejecución pendiente; no promete una release por cada
  merge.
- [`diagramas/flujo.dot`](diagramas/flujo.dot) resume el recorrido de las
  personas usuarias.

`make diagrams` regenera todas las imágenes PNG versionadas en `img/`.
Graphviz procesa las vistas `.dot`; Python 3.10+ y Pillow, fijado en
`requirements.txt`, generan las vistas de secuencia y portada. Para elegir un
intérprete compatible:

```sh
make diagrams PYTHON=python3.12
```

Incluye la fuente del diagrama y su PNG regenerado. Antes de insertar una
figura nueva, revisa el tamaño del texto y los cruces de flechas en el PNG y
en la página PDF a tamaño A4.

### Una tabla

Markdown normal; si quieres que `pandoc-crossref` la numere y puedas
referenciarla con `@tbl:id`, añade una línea de pie justo debajo:

```markdown
| Columna A | Columna B |
| --------- | --------- |
| 1         | 2         |

: Pie de la tabla {#tbl:mi-tabla}
```

### Citar evidencia o una decisión de arquitectura (ADR)

Desde `memoria-postgrado.md` (dos niveles bajo `docs/`), los enlaces
relativos son:

```markdown
[evidencia](../../evidence/issue-70-integration.md)
[ADR-002](../../adr/ADR-002-serverless-without-rds-or-vpc.md)
```

No hace falta citar una evidencia en cada frase — sólo cuando una afirmación
concreta (una cifra, un resultado de prueba, una decisión) se beneficia de
tener detrás un documento verificable.

## 4. Antes de hacer commit

Desde la raíz del repositorio (requiere Node.js 24, sin entorno AWS):

```sh
npm run lint:markdown   # valida todo el repo, incluida esta carpeta
npm run sync:check      # trazabilidad spec/issue/evidencia
npm run paper:pdf       # confirma el build reproducible, incluida la portada
```

Si `lint:markdown` se queja de "Multiple top-level headings" o de un
subtítulo repetido (p. ej. "DynamoDB" aparece en más de un capítulo a
propósito), es esperado: `.markdownlint-cli2.yaml` de esta carpeta ya
desactiva esas dos reglas sólo aquí, porque este `.md` es un documento
multicapítulo, no una página normal del repositorio.

## 5. Flujo de trabajo

### PDF descargable en GitHub Releases

El workflow `Memoria PDF` valida la compilación de las PR relevantes sin
publicar previews ni artefactos descargables. Tras integrar cambios relevantes
en `main`, compila esa revisión y publica una
[GitHub Release](https://github.com/upc-malvaviscos/findly/releases) con
`memoria.pdf`. No hace falta crear un tag manualmente.

Los merges del bot no generan otro workflow `push` por las restricciones de
`GITHUB_TOKEN`. Por eso se evalúa también la terminación de CI, AWS efímero y
CodeQL: primero se confirma que la PR ya está integrada en `main` y que cambió
alguna entrada PDF. La comprobación ligera puede ejecutarse para otros cambios,
pero éstos no compilan ni publican. El checkout, scripts, Makefile y toolchain
son exclusivamente de `main`. Las fuentes del commit integrado se verifican
contra main y se exportan como datos (Markdown, portada e imágenes), sin
symlinks ni ejecución de código histórico. La release enlaza ambos SHAs. No
se consumen artefactos de PR ni código de PR sin integrar.

Si varios eventos corresponden al mismo commit, se conserva una sola release
y se evita repetir el build cuando su PDF ya está publicado. La selección
espera hasta dos minutos por PR ante la carrera entre último check y auto-merge.
Si la fusión se demora más, puede repetirse un job CI ligero de esa PR una
vez integrada. Para recuperación operativa, en **Actions → Memoria PDF → Run
workflow**, elige la rama `main` e introduce opcionalmente el SHA completo de
un commit integrado; si queda vacío, comprueba el HEAD actual de main. La
recuperación verifica PR, ascendencia y rutas igual que el callback automático.

El tag tiene formato `memoria-2026-10-25_18-45`: hora de 24 horas en
`Europe/Madrid`, con ajuste automático de horario de verano. La release
enlaza sus commits de datos/automatización y ejecución, y conserva versiones
anteriores. Las descargas apuntan a un tag concreto, para mantener el acceso
a cada versión aunque cambie la release que GitHub muestra como `Latest`.
El acceso a la descarga conserva la
visibilidad y permisos del repositorio.

Disparadores: `memoria-postgrado.md`, `portada.tex`, `img/**`, `Makefile`,
`pdf-toolchain.json`, los scripts de conversión/publicación, sus pruebas, el
workflow y `.nvmrc`. Otros Markdown, este README y cambios exclusivos de
dependencias de la aplicación no disparan una publicación. Si cambias scripts
de diagramas, regenera y commitea sus imágenes; son las imágenes las que se
incluyen en el PDF.

La cola permite una publicación activa y una pendiente. Durante una ráfaga,
el siguiente merge reemplaza al que esperaba; no se pierden releases ya
publicadas. Si dos publicaciones coinciden en el mismo minuto, espera 61
segundos y vuelve a comprobar (máximo cinco intentos), sin sobrescribir tags.
Un fallo de compilación no publica. Un fallo de subida/publicación puede
dejar un borrador; usa **Re-run jobs** de la misma ejecución para reanudarlo.
Si ya publicó, ese rerun devuelve su release sin reemplazar el PDF. Un asset
incompleto o un tag que identifica otro commit causa un fallo y requiere
inspeccionar el borrador, sin borrados automáticos.

Los checks detectan errores de compilación, referencias no resueltas y avisos
de conversión, pero no sustituyen la revisión visual del PDF. Los minutos de
Actions y assets de Releases consumen las cuotas de GitHub; no se necesita
AWS ni un token externo. No se publica desde PR ni se cambia el ruleset.

Decisión y límites: [ADR-027](../../adr/ADR-027-memoria-pdf-releases.md).

- Rama `docs/...` por cambio, igual que el resto del repositorio (ver
  `AGENTS.md` en la raíz); evita editar varias personas la misma sección a
  la vez para no generar conflictos de merge innecesarios en un fichero
  largo.
- Commitea el `.md`, los scripts de `diagramas/` y las imágenes de `img/`
  que generen. No commitees `memoria.pdf`, `memoria.docx` ni `.venv/`
  (ya están ignorados).
- Si añades una sección nueva de peso (por ejemplo, una ronda de pruebas de
  usuario o nueva evidencia de AWS), compílala en local primero y revisa el
  PDF entero, no sólo el fragmento que has tocado: un error de sintaxis de
  Pandoc en un capítulo puede romper la compilación de los demás.
