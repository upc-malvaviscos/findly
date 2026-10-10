# Evidencia #88: actualización manual, descarga y enlaces compartidos de galería

<!-- requirement: REQ-GALLERY-DOWNLOAD-SHARING -->

## Alcance

Issue [#88](https://github.com/upc-malvaviscos/findly/issues/88), formalizada
en [specs/22-gallery-refresh-download-and-sharing.md](../../specs/22-gallery-refresh-download-and-sharing.md)
(sin spec previa ni entrada en `docs/traceability.json`; se creó la spec antes
de implementar). Continúa spec 08; no reabre la transición EMPTY/SUCCESS que
[#107](https://github.com/upc-malvaviscos/findly/issues/107) ya corrigió.

Cambios:

- `src/lambdas/gallery.ts`: cada foto incluye ahora `downloadUrl`, una segunda
  URL `GET` firmada con `ResponseContentDisposition: attachment;
filename="findly-<photoId>.jpg"`, derivada del `s3Key` ya autorizado por el
  match de ese token (nunca de una clave S3 recibida del navegador). La URL de
  visualización inline (`url`) no cambia.
- `src/web/components/gallery/GalleryPage.tsx`:
  - Botón «Actualizar fotos» que reutiliza `refreshGallery` (misma función
    que el temporizador de 4 minutos), con estado de progreso y error
    recuperable visible.
  - Cualquier refresco (manual o periódico) que reciba `GALLERY_EXPIRED` o
    `GALLERY_NOT_FOUND` detiene el temporizador periódico y muestra el estado
    terminal correspondiente, en vez de dejar datos visuales obsoletos.
  - El enlace «Descargar» del visor usa `downloadUrl` en vez de reutilizar la
    URL de visualización inline.
  - Acción «Copiar enlace de la galería» (`navigator.clipboard.writeText`)
    con advertencia permanente de que quien reciba el enlace puede ver,
    descargar y también borrar la inscripción, y de que compartir no amplía
    la retención.
- `src/web/types.ts`, `src/web/galleryApi.ts`: `GalleryPhoto.downloadUrl`
  añadido al contrato y al mock de desarrollo.

La invalidación cruzada del enlace compartido tras un borrado (cualquiera de
los dos navegadores lo invalida para ambos) es una propiedad ya existente de
`deleteRegistration` — un único token compartido, no dos independientes — y
no se duplica su prueba aquí.

## Validación local

```sh
npm run lint        # PASS
npm run typecheck   # PASS
npx vitest run       # PASS — 63 ficheros, 612 pruebas
npm run build        # PASS
npx playwright test e2e/foundation.spec.ts   # PASS — 36/39 (3 omitidas, ver abajo)
```

Pruebas nuevas/reescritas relevantes:

- `tests/lambdas/gallery.test.ts`: `issues a separate attachment URL
authorized only for the matched photo` — verifica que `downloadUrl` difiere
  de `url`, que la llamada a `getSignedUrl` que produce `downloadUrl` incluye
  `ResponseContentDisposition: attachment; filename="findly-photo-1.jpg"`, y
  que la `Key` firmada es la del `s3Key` ya autorizado por el match (no una
  clave arbitraria).
- `tests/web/gallery.test.tsx`:
  - `downloads through the authorized attachment URL, not the inline viewing
URL` (sustituye al test anterior que solo comprobaba `href`/`download`).
  - `refreshes manually on demand without waiting for the periodic timer`.
  - `shows a recoverable error when a manual refresh fails on the network`.
  - `stops the periodic refresh and shows the expired state when a refresh
finds the link expired`.
  - `copies the shareable gallery link with a deletion-capability warning`.
- `e2e/foundation.spec.ts` (Chromium/Firefox/WebKit salvo que se indique):
  - `refreshes the gallery manually without reloading the page`.
  - `the download control targets the authorized attachment URL, not the
inline viewing URL`.
  - `downloads the real photo file through the authorized attachment URL`
    (Chromium/Firefox): doble fiel de otro origen que responde con
    `Content-Disposition: attachment` y verifica nombre **y contenido** del
    archivo descargado, no solo el atributo `download`. **No es AWS/S3
    real.**
  - `shares a gallery link that opens the same gallery in another browser
context without login`.
  - `copies the shareable link to the clipboard` (solo Chromium).

### Omisiones documentadas (3 de 39 en el fichero completo)

- **WebKit**, prueba de contenido descargado: Playwright/WebKit no emite el
  evento `download` para anclas cuya respuesta se sirvió mediante
  intercepción `page.route`. Se verificó en aislamiento con un repro mínimo
  ajeno a esta app (ancla cross-origin interceptada con
  `Content-Disposition: attachment`): falla igual. Es una limitación de la
  automatización WebKit de Playwright, no del contrato HTTP bajo prueba, que
  la prueba de atributos `href`/`download` (`the download control targets…`)
  sí cubre en WebKit.
- **Firefox y WebKit**, prueba de portapapeles: Playwright solo permite
  conceder los permisos `clipboard-read`/`clipboard-write` en Chromium.

## Comprobaciones con hallazgos ajenos a este cambio

- `npm run security` (`npm audit --omit=dev`) reportó una vulnerabilidad alta
  preexistente en `source-map-js` (dependencia transitiva de dev: vitest,
  jsdom, vite), sin relación con los archivos tocados por la issue #88. Se
  corrigió con `npm audit fix` (bump a `source-map-js@1.2.2`, solo
  `package-lock.json`, sin cambios en `package.json`); `npm run security` pasa
  limpio.

### `npm run terraform:validate` intermitente — causa raíz y corrección

Una entrada anterior de esta evidencia atribuía la intermitencia de
`terraform:validate` (fallo en distinto entorno —sandbox, demo o production—
en ejecuciones sucesivas, sin cambios en `infra/`) a una posible carrera con
el Terraform Language Server del editor indexando el árbol en segundo plano.
Investigación posterior, al intentar el push de esta rama, descartó esa
hipótesis y encontró la causa real:

- El bloque `validation` de `permissions_boundary_arn` en
  [infra/modules/findly-stack/variables.tf](../../infra/modules/findly-stack/variables.tf)
  referenciaba `var.environment` (validación cruzada entre variables,
  disponible desde Terraform 1.9). El evaluador de grafo de Terraform 1.15
  resuelve esa referencia de forma no determinista: en copias aisladas e
  idénticas de `sandbox`, `demo` y `production`, `terraform validate` falló
  de forma aleatoria (~50 % de las ejecuciones) con `Error: Reference to
uninitialized variable` en cualquiera de los tres entornos, y pasó limpio
  en las repeticiones restantes con la misma configuración. Reproducido
  fuera del script de validación (`terraform validate` directo) y descartado
  como problema de la config: la condición en sí es correcta y siempre
  determinista en su resultado lógico, solo el momento de evaluación de la
  referencia cruzada era inestable.
- Corrección: se sustituyó el bloque `validation` por una `precondition` en
  un output interno dedicado
  (`output "_permissions_boundary_guard"` en
  [infra/modules/findly-stack/outputs.tf](../../infra/modules/findly-stack/outputs.tf)),
  que expresa la misma condición desde el grafo de expresiones ordinario en
  vez del subsistema de validación de variables. Se descartó deliberadamente
  un bloque `check` (alternativa más obvia): verificado empíricamente que un
  `check` fallido solo emite un _warning_ en `terraform plan`/`apply` reales
  (no bloquea), mientras que la `precondition` de un output sí produce
  `Error` y aborta con código de salida distinto de cero, igual que el
  bloque `validation` original. La garantía de seguridad (producción exige
  `permissions_boundary_arn`) se mantiene con la misma fuerza.
- Verificación: `terraform validate` repetido 18 veces en total (10 + 8)
  contra copias aisladas de los tres entornos tras la corrección, sin ningún
  fallo. `npm run terraform:validate` real, ejecutado 3 veces consecutivas
  tras aplicar el fix en el repositorio, también limpio las 3 veces.
- Prueba añadida: `infra/modules/findly-stack/tests/permissions-boundary.tftest.hcl`
  (`terraform test` con `mock_provider`, sin credenciales reales), ejecutada
  por el nuevo script `scripts/test-findly-stack-infra.mjs` y expuesta como
  `npm run terraform:test:findly-stack`, incorporado a `npm run verify`.
  Cubre: producción sin boundary → `expect_failures` sobre el output guard;
  producción con boundary → acepta; entorno no productivo sin boundary →
  acepta. `npm run verify` completo (lint, typecheck, test, build,
  terraform:format/validate/test:hosting/test:email/test:findly-stack,
  security, sync:check) pasa de extremo a extremo tras el fix.

Ningún otro módulo usa este patrón de validación cruzada entre variables
(`grep` confirmó que `permissions_boundary_arn` era el único caso en
`infra/`), así que no se requirió tocar otros módulos.

### CI del PR #117 — `floci/floci:latest` rompe los PUT condicionales

El job `e2e` de CI falló de forma reproducible (no intermitente: se relanzó
una vez con el mismo resultado) en `tests/integration/selfieIndexer.test.ts`,
con `AssertionError: expected 400 to be 200` en los PUT firmados
condicionales (`If-None-Match: *`, subida "write-once" de selfies, ver
[src/lambdas/lib/presignedUpload.ts](../../src/lambdas/lib/presignedUpload.ts)).
Ninguno de esos archivos lo toca este PR.

Causa: `docker-compose.yml` y `tests/integration/floci.compose.yml`
referenciaban `floci/floci:latest`, una etiqueta flotante. La imagen que
Docker tenía cacheada localmente era de 2026-09-15
(`sha256:ab456f84…`, con la que el test pasa 14/14); CI, al no tener caché,
siempre descarga la última imagen publicada. Al forzar un `docker pull`
fresco en local, obtuve la imagen de 2026-10-06 (`sha256:0d1fa7a9…`,
publicada como `floci/floci:2.2.0`) y reproduje el mismo fallo en local:
esa versión rechaza con 400 los PUT firmados con `If-None-Match`. Confirmado
contra `https://hub.docker.com/v2/repositories/floci/floci/tags`: existe una
etiqueta semver estable `2.1.0` (2026-09-15) que resuelve exactamente a la
imagen que funciona.

Corrección: ambos ficheros compose se fijaron a `floci/floci:2.1.0` en vez
de `:latest`. Se intentó primero fijar por dígest exacto
(`floci/floci@sha256:ab456f84…`), pero Docker Hub rechaza el pull directo de
ese manifiesto ("manifest schema unsupported"); la etiqueta semver sí se
descarga limpiamente y resuelve al mismo `Id` de imagen. Verificado:
`npm run test:floci:integration` pasa 14/14 tras el pin, con caché de Docker
vaciada y reconstruida desde cero.

No se investigó el motivo del cambio de comportamiento en `2.2.0` (podría
ser una corrección legítima de semántica S3 o una regresión de Floci); se
deja pendiente como seguimiento, sin bloquear este PR.

## Verificación contra AWS real (entorno efímero del PR)

El job `provision-test-destroy` (`.github/workflows/ephemeral-pr-e2e.yml`)
despliega un entorno real y aislado por PR (`infra/ephemeral`, rol OIDC
dedicado) y lo destruye al terminar. Hasta ahora solo comprobaba la URL de
visualización inline heredada de la issue #70; no ejercía `downloadUrl`, la
cabecera `attachment` ni el contenido descargado. Se consideró el bucket
compartido `sandbox` (`terraform plan` contra el estado real:
`findly-tfstate-912415493378`, `eu-west-1`, 109 recursos a crear desde
cero) como alternativa, pero se descartó para no desplegar infraestructura
persistente y manual solo para esta verificación.

Se amplió `scripts/deployed-ephemeral-happy-path.mjs` para, en el mismo
entorno real desplegado y autodestruido por el PR:

- comprobar que `downloadUrl` existe y difiere de `url`;
- descargar `downloadUrl` real contra S3 real y verificar
  `Content-Disposition: attachment; filename="findly-<photoId>.jpg"`;
- verificar que el contenido descargado coincide con los bytes JPEG
  sintéticos subidos.

El acceso sin login desde "otro navegador" ya estaba cubierto
estructuralmente: `/gallery?token=` no usa cookies ni sesión en ninguna de
las llamadas de este script.

## Pendiente

- Resultado de la ejecución ampliada del CI efímero sobre el commit que
  añade estas comprobaciones. El PR #117 (resto de la issue #88) ya se
  fusionó antes de que este commit llegara a tiempo; se abrió un PR
  separado solo para esta verificación (`fix/issue-88-ephemeral-download-verification`)
  y queda pendiente confirmarlo en verde ahí.
- Resto de criterios de aceptación de la issue #88 que requieren
  verificación manual/visual (no automatizable aquí): revisión humana del
  PR y de la demo.
- Investigar por qué `floci/floci:2.2.0` rechaza con 400 los PUT firmados
  condicionales (`If-None-Match`) y decidir si actualizar el pin tras
  entender el cambio, en vez de quedarse indefinidamente en `2.1.0`.
