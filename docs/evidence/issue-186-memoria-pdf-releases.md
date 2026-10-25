# Evidencia de #186: publicación automática de la memoria PDF

<!-- requirement: REQ-MEMORIA-PDF-RELEASE -->

Issue: [#186](https://github.com/upc-malvaviscos/findly/issues/186).
Decisión: [ADR-027](../adr/ADR-027-memoria-pdf-releases.md).

## Alcance y entorno

Validación local del 2026-10-25, Node 24, macOS ARM con Docker Linux AMD64.
No se usan AWS, datos biométricos ni credenciales dentro de la conversión.
La publicación a GitHub se prueba con respuestas simuladas: no acredita una
release real ni permisos efectivos de `GITHUB_TOKEN`.

Toolchain del contenedor oficial, fijado por digest en
`docs/paper/memoria-findly/pdf-toolchain.json`:

- Pandoc 3.8.3.
- pandoc-crossref v0.3.22, construido con Pandoc 3.8.3.
- XeTeX 3.141592653-2.6-0.999997, TeX Live 2025; incluye `fancyhdr` y español.

## Compilación y revisión PDF

`npm run paper:pdf` invoca el Makefile existente a través del contenedor
fijado. La compilación real produjo un PDF A4 de 24 páginas con portada,
índice, figuras, referencias cruzadas y tablas. Se renderizaron las 24 páginas
con Poppler y se revisó la composición completa. La tabla de claves DynamoDB
presentaba solapamientos en la fuente previa: sus consultas se trasladaron a
prosa contigua para dar espacio a las tres columnas, sin cambiar claves ni
significado. La revisión de detalle confirmó que las claves ya no se solapan.

Se contrastaron también dos entradas sintéticas con el convertidor real:
referencia `@fig:does-not-exist` e imagen `img/does-not-exist.png`. Ambas
terminaron con código 1 y diagnósticos de Pandoc/LaTeX, impidiendo publicación.
Los ficheros de prueba temporales se eliminaron; no alteraron la memoria real.

En el host ARM, la emulación emitió mensajes de runtime Haskell
`Ticker: poll failed: Interrupted system call`; la conversión terminó con
código cero. No se suprimen avisos de Pandoc, crossref o LaTeX. La aceptación
del runner Linux AMD64 de GitHub se comprueba por separado.

El PDF y las imágenes de revisión son salidas locales ignoradas o temporales;
no se añaden a Git. El producto publicado será el asset `memoria.pdf`.

## Pruebas y aceptación

`tests/infra/memoriaRelease.test.ts` usa PDF sintético y API GitHub simulada.
Contrasta Madrid en invierno/verano y medianoche, colisión por cambio horario,
borrador antes de upload/publicación, error de upload, reanudación de borrador,
rerun sin mutaciones, preservación de tags, rechazo de errores API y cambio de
commit del tag, y ausencia de publicación desde PR o con un fichero no PDF.
Otros cinco casos simulan el ejecutable Docker para comprobar la propagación
de errores, avisos de filtros y glifos ausentes. Son 16 pruebas específicas,
separadas de la compilación real anterior. La declaración TypeScript del
cliente GitHub mantiene el contrato estricto sin `any` ni supresiones.

`npm run verify` pasó completo: lint (incluido actionlint), tipos estrictos,
838 pruebas en 77 ficheros, build, formato y validación Terraform, suites
Terraform con proveedor simulado, contrato de permisos, auditoría de
dependencias (cero vulnerabilidades) y `sync:check` (22 requisitos).
`npm run harness:check` y `git diff --check` también pasaron. No se ejecutó
E2E de aplicación en local: no cambia ningún recorrido web/API; la suite CI
general mantiene sus comprobaciones existentes.

La
cola estándar fue aprobada explícitamente tras comprobar que la opción
GitHub `queue: max` no es reconocida por actionlint 1.7.12. Se mantuvo el
validador sin supresiones ni parches y se documentó la sustitución de la
ejecución pendiente durante ráfagas.

## Aceptación remota de PR

La [PR #187](https://github.com/upc-malvaviscos/findly/pull/187) contiene la
implementación. El [run PDF 40208336910](https://github.com/upc-malvaviscos/findly/actions/runs/40208336910)
del commit `4f2307b9f58cbbe8616cc7e71fd76e555bf09291` terminó con éxito:
`validate` compiló el documento real en Ubuntu 24.04 Linux AMD64;
`publish` quedó omitido. La API de artefactos del run devolvió `total_count: 0`:
no se publicaron previews. El workflow AWS efímero
[40208336895](https://github.com/upc-malvaviscos/findly/actions/runs/40208336895)
también quedó omitido por ser PR en borrador; no es evidencia AWS.

Pendientes de completar antes de declarar la issue cerrada:

- Tras el merge autorizado, primera release publicada por `push` a `main`.
- Comprobar tag/commit, timestamp Madrid, asset descargable y PDF obtenido.
- Enlazar PR, ejecuciones y release en la issue y actualizar su checklist.

La aprobación del plan no autoriza a integrar directamente en `main`. No se
cierra la issue ni se declara una publicación real a partir del build local.
