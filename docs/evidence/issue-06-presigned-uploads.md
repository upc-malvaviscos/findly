# Evidencia de subidas prefirmadas y política de claves S3

Implementación de la spec 05 (issue #6): generación de URLs `PUT`
prefirmadas hacia S3, política de claves deterministas y el bucket privado
que las respalda.

## Alcance verificado

- `src/shared/lib/s3Keys.ts`: `selfieObjectKey`/`eventPhotoObjectKey`
  generan las claves deterministas `events/{eventId}/selfies/{registrationId}.jpg`
  y `events/{eventId}/photos/{photoId}.jpg` definidas en la spec.
- `src/lambdas/lib/presignedUpload.ts`: función reutilizable
  `createPresignedUploadUrl` (no un endpoint HTTP propio — spec 02 no define
  ninguno; las URLs prefirmadas viajan embebidas en las respuestas de
  `POST /events/{eventId}/registrations` e
  `POST /admin/events/{eventId}/photos/uploads`, aún no implementadas). Usa
  `@aws-sdk/s3-request-presigner` con expiración fija de 300 segundos.
- `src/web/imageConversion.ts`: normaliza cualquier imagen aceptada por el
  dropzone (`JPG, PNG o WEBP`) a JPEG mediante `canvas` antes de subirla,
  resolviendo la incompatibilidad entre la política de claves/`Content-Type`
  de la spec 05 (siempre `image/jpeg`) y los tipos que la spec 03 permite
  subir.
- `src/web/s3Uploader.ts`: implementación real de `uploadFileToS3` con
  `XMLHttpRequest` (`xhr.upload.onprogress`), sustituyendo el pitfall
  documentado de intentar usar `fetch` para progreso de subida. Envía
  siempre `Content-Type` igual al `file.type` del archivo ya convertido a
  JPEG, evitando el 403 de firma que documenta la spec.
- `SelfieCaptureForm.tsx` ahora convierte el archivo a JPEG
  (`ensureJpegFile`) justo antes de subirlo. El componente sigue usando el
  adaptador mock (`../api`) para `uploadFileToS3`; la sustitución por el
  adaptador real (`src/web/s3Uploader.ts`) es explícitamente el alcance de
  la issue #22, no de esta.
- `infra/modules/uploads-bucket/`: módulo Terraform reutilizable para el
  bucket S3 (privado, `aws_s3_bucket_public_access_block` con las 4
  restricciones activas, SSE-S3/AES256, CORS restringido a
  `var.frontend_domain_url` con `allowed_methods = ["PUT"]` y
  `allowed_headers = ["Content-Type"]` únicamente). Etiquetado con
  `Project`, `Environment`, `ManagedBy`, `CostCenter` y `DataClass` (los
  tres últimos como variables con valores por defecto, ya que ninguna spec
  ni ADR fija sus valores concretos). Deliberadamente **no** conectado a
  ninguna raíz Terraform: `infra/main.tf` no tiene `provider "aws"`
  configurado todavía — eso es responsabilidad explícita de la issue #11
  (spec 10), en `infra/environments/sandbox/main.tf`.

## Hallazgo colateral corregido

Al añadir pruebas para `imageConversion.ts`/`s3Uploader.ts` (archivos
`.test.ts` sin JSX en `tests/web/`), se descubrió que el proyecto Vitest
`web` en `vitest.config.ts` solo incluía `tests/web/**/*.test.tsx`, dejando
fuera silenciosamente cualquier `.test.ts` en ese directorio. Esto también
afectaba a `tests/web/apiClient.test.ts`, ya existente, que nunca se había
ejecutado desde que se fusionó (issue #4). Se corrigió el glob a
`tests/web/**/*.test.{ts,tsx}`. Al ejecutarse por primera vez,
`apiClient.test.ts` falló por un error en la propia prueba (uso de
`expect.objectContaining` sobre una instancia de `Headers`, que no expone
sus entradas como propiedades enumerables) — no en `apiClient.ts`, cuya
lógica de cabecera `Authorization` es correcta. Se corrigió únicamente la
aserción de la prueba.

## Pendiente

- El módulo Terraform no está desplegado ni conectado a una raíz real; la
  verificación en vivo de rechazo de firma/CORS y de cifrado en reposo
  queda pendiente hasta que la issue #11 aporte el proveedor AWS y el
  backend de estado.
- `createPresignedUploadUrl` no tiene todavía ningún consumidor real: lo
  invocarán las issues #5 (administración) y #7 (inscripción facial) al
  construir sus propios handlers.
- No se abre ADR nuevo: las decisiones de diseño (helper reutilizable en
  vez de endpoint propio; módulo Terraform independiente; conversión a
  JPEG en cliente) son implementación de lo ya definido en specs 02/03/05,
  no nuevas decisiones arquitectónicas de alto nivel.

## Validación

```text
npm run typecheck            PASS
npm run lint:code             PASS
npm run test                  PASS (42 tests, 13 archivos)
npm run build                 PASS (web + lambdas + verificación de artefactos)
terraform validate (módulo)   PASS (infra/modules/uploads-bucket, validado de
                               forma independiente; el script npm
                               terraform:validate no lo alcanza porque no
                               está conectado a infra/ todavía)
npm run terraform:format      PASS (recursivo, incluye el módulo)
npm run terraform:validate    PASS (raíz infra/, sin cambios)
```

No se ejecuta `npm run test:e2e` en esta issue: no se modifica ningún flujo
de usuario visible (`SelfieCaptureForm` sigue usando el adaptador mock sin
cambios de comportamiento observables).
