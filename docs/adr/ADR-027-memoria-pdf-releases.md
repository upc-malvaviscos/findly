# ADR-027: compilación y publicación de la memoria PDF

Estado: aprobado por el responsable el 2026-10-25 para
[#186](https://github.com/upc-malvaviscos/findly/issues/186). Primera publicación
real posterior al merge pendiente; no se acredita con pruebas simuladas.

## Contexto

La memoria académica ya tiene un Makefile, portada LaTeX e imágenes versionadas,
pero su compilación depende de herramientas instaladas por cada autor. Se
necesita un PDF descargable por versión, sin versionar binarios en Git ni
desplegar infraestructura AWS.

## Decisión

Usar Pandoc, pandoc-crossref y XeLaTeX del contenedor oficial `pandoc/extra`,
fijado por digest en `pdf-toolchain.json`. La plataforma Linux AMD64 permite
ejecutar el mismo entorno en Actions y, mediante emulación, en macOS ARM.
`npm run paper:pdf` reutiliza `make pdf` con un adaptador de Pandoc en Docker.
No instala paquetes durante la conversión ni regenera diagramas: usa las
imágenes ya revisadas en Git. La conversión no tiene red ni credenciales y
monta únicamente la carpeta de la memoria.

Una PR relevante compila sin publicar previews. Un push relevante a `main`
compila su revisión exacta y publica `memoria.pdf` en GitHub Releases. Los
disparadores incluyen Markdown, portada, imágenes, Makefile, configuración del
contenedor, scripts y workflow PDF y versión Node. Cambios en otras memorias
Markdown o dependencias de la aplicación no publican un PDF.

Los tags son `memoria-YYYY-MM-DD_HH-mm`, con reloj de 24 horas y zona IANA
`Europe/Madrid`, incluidos los cambios de horario estacional. Una colisión de
minuto, incluido el cambio de hora de otoño, espera 61 segundos y consulta de
nuevo, hasta cinco intentos. No se sobrescriben tags ni releases existentes.
La release enlaza el commit completo y la ejecución; el commit no forma parte
del nombre. La hora corresponde al intento de publicación, después del build.

El responsable aprobó la cola estándar de Actions: una publicación activa y
una pendiente, sin cancelar la activa. En una ráfaga, una nueva ejecución
reemplaza a la pendiente anterior; por tanto, se conservan todas las versiones
publicadas, pero no se garantiza una release por cada merge intermedio.
`queue: max`, aunque soportado por GitHub, no pasa actionlint 1.7.12; no se
suprime ese validador ni se introduce un mecanismo externo de bloqueo.

La publicación crea primero un borrador, sube el PDF y después publica. Sólo
el job de publicación recibe `contents: write`; checkout no persiste su token
y PR usa permisos de lectura, sin `pull_request_target`. Un rerun de la misma
ejecución reanuda su borrador o devuelve su release terminada; un upload
incompleto exige revisión y falla sin reemplazarlo. Las releases documentales
no se marcan como `latest`, para no sustituir una futura release de la aplicación.

## Límites y validación

El build rechaza avisos de Pandoc, referencias no resueltas de pandoc-crossref y
glifos ausentes comunicados por LaTeX. No detecta todos los defectos visuales;
la revisión inicial incluye renderizado de todas las páginas. No se atribuyen
conformidad PDF/A, accesibilidad PDF/UA ni reproducibilidad byte a byte: los
metadatos PDF incluyen la fecha de compilación.

No cambia el ruleset de ramas ni convierte un check filtrado por paths en
obligatorio. GitHub limita la evaluación de filtros a su diff de archivos;
un cambio excepcionalmente grande requiere comprobar que el workflow se ejecuta.
Los minutos de Actions y los assets de Releases consumen las cuotas de GitHub;
no se crean servicios de coste fijo ni se concede acceso a AWS.

La [evidencia de #186](../evidence/issue-186-memoria-pdf-releases.md) distingue
compilación local real, pruebas simuladas de publicación y aceptación remota.

Referencias: [imagen oficial](https://github.com/pandoc/dockerfiles),
[filtros de rutas](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore),
[GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases).
