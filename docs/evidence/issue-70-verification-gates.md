# Issue 70: firma de cargas y gates de cobertura

## Implementación y comprobaciones locales

El SDK de AWS excluye `Content-Type` de la firma S3 por defecto. Una ejecución
local del SDK con credenciales sintéticas devolvió `X-Amz-SignedHeaders=host`.
El presigner ahora pasa `signableHeaders: new Set(['content-type'])`; el test
usa el SDK real, sin mock de `getSignedUrl`, y comprueba
`content-type;host`, SigV4, clave de objeto y 300 segundos de expiración.
No llama a AWS ni demuestra todavía el rechazo del servidor S3.

`npm test`: 189 tests en 26 archivos, todos verdes. Líneas de handlers Lambda:
98,38 %; helpers Lambda: 100 %; `src/shared/lib`: 100 %. `npm run typecheck`
y `npm run lint:code` también pasan. La cobertura incluye todos los archivos
`src/**/*.{ts,tsx}`, incluidos los no ejecutados, sin excluir lógica de negocio.
El porcentaje global (78,46 %) no es el criterio de este gate.

`npm run harness:check` y `npm run verify` completos pasan: formato, Markdown,
TFLint, actionlint, tipos, tests, build web, empaquetado/verificación de seis
Lambdas, Terraform validate de cinco raíces, auditoría de dependencias de
producción (cero vulnerabilidades) y `sync:check`. TFLint requirió ejecutar
fuera del sandbox para que su plugin arrancase; no se modificó el gate.

Vitest exige al menos 90 % de líneas separadamente para
`src/lambdas/**/*.ts` y `src/shared/lib/**/*.ts`. Prueba negativa reproducible:

```sh
npm exec -- vitest run --coverage --project lambdas \
  tests/lambdas/lib/presignedUploadSignature.test.ts
```

El test individual pasa y el proceso falla con código 1: cobertura Lambda
2,38 % y shared/lib 0 %, ambas bajo 90 %. Esto demuestra que ejecutar una
suite incompleta no puede producir un resultado de cobertura aprobado.

## Smoke AWS preparado; ejecución pendiente

`scripts/deployed-upload-security.mjs` requiere las variables
`EPHEMERAL_API_ENDPOINT`, `EPHEMERAL_ID_TOKEN`,
`EPHEMERAL_UPLOADS_BUCKET_NAME` y `EPHEMERAL_FRONTEND_ORIGIN`.
La sesión necesita los permisos del smoke administrativo existente y
`s3:GetObject` en las claves sintéticas y `s3:ListBucket` limitado al prefijo
de pruebas, para distinguir un objeto ausente (404) de un acceso denegado (403).

El script usa claves distintas para mutar método, clave y Content-Type,
exige 403 de S3 y verifica que ningún objeto exista. Chromium ejecuta PUT
desde un documento del origen permitido y otro del origen prohibido;
solo el documento vacío se sirve localmente, sin interceptar S3. Comprueba
subida permitida con JPEG sintética generada en canvas de 64 píxeles y SSE-S3,
y ausencia de objeto para el origen rechazado.
Este probe acredita CORS del navegador cuando se ejecute, no el recorrido
completo de la SPA ni una prohibición de clientes HTTP fuera del navegador.
No imprime URLs firmadas ni guarda HAR. Los objetos y metadatos sintéticos
se eliminan mediante el destroy obligatorio del stack efímero.

`scripts/deployed-dlq-redrive.mjs` requiere `EPHEMERAL_PHOTOS_QUEUE_URL`,
`EPHEMERAL_PHOTOS_DLQ_URL`, `EPHEMERAL_UPLOADS_BUCKET_NAME` y
`EPHEMERAL_RESOURCE_PREFIX=findly-pr-<numero>`. Requiere AWS CLI y permisos
`sqs:GetQueueAttributes`, `sqs:SendMessage` sobre origen y
`sqs:ReceiveMessage`, `sqs:DeleteMessage` sobre DLQ del PR.
Verifica destino y `maxReceiveCount=3` antes de enviar un evento S3 sintético
válido hacia colección/objeto inexistentes. JSON inválido sería ignorado por
PhotoMatcher y no probaría redrive. Sondea durante cuatro visibility timeouts
más 120 segundos, con máximo de 30 minutos. Exige mismo MessageId y body en
la DLQ y elimina solo ese mensaje. No confunde el receive count de la DLQ
con el número de intentos en origen. El destroy del stack elimina cualquier
mensaje remanente tras un fallo. No cambia visibility timeout ni redrive.

Ninguno de los dos smoke se ha ejecutado en AWS en esta entrega.
Las issues #6, #8, #45 y #46 conservan su verificación runtime pendiente.
