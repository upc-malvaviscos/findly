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

## Corrección de elegibilidad AWS aprobada

Al marcar #187 como lista para revisión, el diff completo incluía el workflow
PDF, sus scripts/pruebas y `package.json`; la regla anterior clasificó esos
ficheros como desplegables y lanzó AWS incluso tras un commit sólo documental.
Una PR de Markdown puro ya se omitía correctamente. La corrección aprobada
reconoce las rutas exactas de tooling PDF y compara el manifiesto respecto al
merge-base, ignorando únicamente la entrada npm `paper:pdf`.

Regresión reproducida antes del fix: cuatro fallos en
`npm exec -- vitest run --project infra tests/infra/ephemeralPrEligibility.test.ts`
(tooling PDF, entrada npm y dos historias Git sintéticas). Tras corregir la
regla y el lector de revisiones, pasan las 34 pruebas de ese fichero y los tipos
estrictos. El runner real, sin etiqueta de omisión, devuelve
`deploy_required=false` para el alcance original de 16 ficheros de #187.

Los negativos conservan AWS para cambios mixtos, aplicación, Terraform,
workflows de despliegue, lockfile, otros scripts, el propio control de
elegibilidad, dependencias, engines, build/lifecycle y otros campos del
manifiesto. Los contenidos ausentes o inválidos no se eximen. Dos fixtures Git
ejecutan el runner completo sin override: prueban tanto una base estable como
`origin/main` avanzado con dependencias diferentes, usando el ancestro correcto.

El responsable aprobó retener la PR durante la corrección y cancelar sólo el
run pendiente sin jobs. El run
[40208727680](https://github.com/upc-malvaviscos/findly/actions/runs/40208727680)
se canceló después de verificar `status: pending`, `jobs: []`. El run activo
[40208663357](https://github.com/upc-malvaviscos/findly/actions/runs/40208663357)
se dejó terminar: su conclusión y el paso `Destroy the PR environment` fueron
`success`. Esto prueba su limpieza, no una nueva aceptación funcional del fix.

Como esta corrección modifica el propio gate, esos ficheros no se añaden a la
lista de excepciones. #187 usa la omisión operativa explícitamente aprobada
(`skip-ephemeral-approved`); las futuras PR sólo PDF se clasifican sin etiqueta.
Quedan pendientes el check remoto de la corrección y la primera publicación
real en main. No se altera el ruleset ni se omiten los checks estáticos o E2E.

## Callback post-merge sin credenciales adicionales

La PR #187 se integró en `ea536660cd71ced8d1865cba1e072a922f28f40f`, pero el
auto-merge de `github-actions[bot]` no produjo ningún run `push`: el uso de
`GITHUB_TOKEN` suprime esos eventos encadenados. Se observó únicamente el
análisis dinámico de CodeQL para ese commit. Por tanto, aquella integración
no acreditó la publicación automática. El responsable aprobó añadir un
callback que verifica el origen integrado, sin nuevas credenciales.

La nueva selección usa metadatos GitHub y código de `main`: comprueba repo,
estado merged, base main, head/merge SHA, ascendencia del commit y todos los
archivos de la PR. Sólo un cambio relevante selecciona un commit para build.
El checkout es exclusivamente de main. Las fuentes verificadas se exportan
como datos, sin checkout ni ejecución de Makefiles/scripts históricos; no se
descargan artefactos de PR ni se ejecuta código de una PR sin integrar. Sólo
la publicación recibe escritura. Se deduplica por SHA entre push, callback,
rerun y recuperación, comprobando una release existente antes de otro build.

Validación local de este cambio:

- 74 pruebas específicas pasan entre selector, publicación y elegibilidad.
- Tipos estrictos, ESLint, Markdown, actionlint y trazabilidad pasan.
- Una consulta sólo de lectura contra los metadatos reales del run CI
  `40211074182` resolvió `{sha: ea536660cd71ced8d1865cba1e072a922f28f40f,
pullNumber: 187}`. Esto verifica selección real, no publicación.
- Se verificó que el CodeQL nativo usa el path
  `dynamic/github-code-scanning/codeql` y un nombre dinámico `Push on main`;
  el selector reconoce su path estable.
- La memoria actualizada compila a 24 páginas A4; se renderizó y revisó el
  conjunto completo tras añadir la explicación del artefacto documental.

Los tests incluyen carrera entre check y auto-merge, timeout acotado, fork,
head obsoleto, PR sin integrar, otra rama, commit fuera de main, paginación,
enumeración incompleta, cambios ajenos, recuperación y deduplicación por SHA.
No prueban por sí solos que GitHub entregue el callback; esa aceptación y la
descarga de la primera release continúan pendientes.

El workflow debe existir en main para recibir `workflow_run`. Si los checks
de su propia incorporación ya terminaron antes del merge, se puede repetir
un job CI ligero de esa PR integrada para verificar el callback real. La
recuperación manual restringida a main no sustituye esa prueba automática.

### Frontera de ejecución tras el análisis de CodeQL

La primera revisión de #188 produjo el finding crítico
`actions/untrusted-checkout/critical` en el checkout de `needs.source.outputs.sha`
seguido de ejecución potencial de su Makefile. No se suprimió ni desactivó el
gate. Se retiró por completo ese checkout: sólo se obtiene main, con su
Makefile, adaptador y toolchain. Un exportador lee blobs de Markdown, portada
e imágenes del ancestro verificado; rechaza symlinks/submódulos y nunca copia
el Makefile ni scripts de esa revisión. El PDF se construye con código actual
de main, en un contenedor que sólo monta esos datos y no recibe credenciales.
La release registra los commits de datos y de automatización por separado.

Las cuatro regresiones adicionales del exportador prueban sólo datos,
ausencia de ejecución/copia de Makefile histórico, rechazo de un commit fuera
de main, symlink sin seguimiento y preservación de un destino preexistente.
Las 78 pruebas específicas pasan. Un ensayo local exportó 11 blobs reales de
`ea536660cd71ced8d1865cba1e072a922f28f40f`; la compilación con Makefile/adaptador
confiables y directorio de datos separado terminó con código cero y produjo
un PDF A4 de 24 páginas. La nueva aceptación CodeQL remota continúa pendiente.
