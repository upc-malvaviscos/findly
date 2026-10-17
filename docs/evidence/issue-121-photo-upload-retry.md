# Evidencia: reintento selectivo y deduplicación en la subida de fotografías

<!-- requirement: REQ-PHOTO-UPLOAD-RETRY -->

Implementación de la spec [05](../../specs/05-presigned-upload-and-object-key-policy.md)
(contrato backend) y la spec [04](../../specs/04-admin-event-management-and-cognito-authorization.md)
(`BulkPhotoUploader`), según [ADR-024](../adr/ADR-024-photo-upload-retry-and-stable-operation-id.md)
([issue #121](https://github.com/upc-malvaviscos/findly/issues/121)).

Fusionada en `main` mediante [PR #149](https://github.com/upc-malvaviscos/findly/pull/149)
y, tras un hallazgo de esa misma fusión (ver más abajo),
[PR #150](https://github.com/upc-malvaviscos/findly/pull/150). Ambos PR
desplegaron el entorno efímero real (`provision-test-destroy`,
`.github/workflows/ephemeral-pr-e2e.yml`) y lo destruyeron al terminar; la
validación local cubre además unitarias con `aws-sdk-client-mock`, un
componente con React Testing Library, `terraform fmt`/`validate`, build y
lint.

## Alcance

- `src/shared/lib/validations.ts`: `photoUploadRequestSchema` exige
  `operationId` (UUID) por archivo y rechaza duplicados dentro del mismo
  lote.
- `src/shared/types/entities.ts`: `PhotoEntity` añade `fileName` y
  `deletedAt` (tombstone opcional).
- `src/shared/types/api.ts`: `PhotoUploadRequest`/`PhotoUploadOutcome` —
  unión discriminada `{ uploadUrl, expiresInSeconds }` |
  `{ status: 'COMPLETED' }` | `{ error: 'PHOTO_DELETED' | 'OPERATION_MISMATCH' }`.
- `src/lambdas/adminEvents.ts`:
  - `resolvePhotoUpload` resuelve cada archivo del lote de forma
    independiente: crea, renueva (`HeadObjectCommand` contra S3 antes de
    volver a firmar), confirma (`COMPLETED` sin firmar) o rechaza
    (`OPERATION_MISMATCH`/`PHOTO_DELETED`). `photoId = operationId`.
  - `deleteEventPhoto` deja un tombstone (`UpdateCommand` con `deletedAt`,
    sin `s3Key`/`fileName`) en vez de `DeleteCommand`.
  - `listEventPhotos` añade `FilterExpression:
attribute_not_exists(deletedAt)` para excluir tombstones.
- `src/lambdas/lib/awsErrors.ts`: `isMissingResourceError` reconoce el
  `NotFound` de `HeadObjectCommand`.
- `infra/modules/admin-api/main.tf`: `create_uploads` añade `s3:GetObject`
  (acotado al mismo prefijo que `s3:PutObject`); `delete_photo` añade
  `dynamodb:UpdateItem` (tombstone).
- `src/web/components/admin/BulkPhotoUploader.tsx`: `operationId` estable
  por archivo, estado explícito (`pending`/`uploading`/`completed`/`failed`),
  reintento selectivo (solo reenvía lo no `completed`), maneja `COMPLETED`
  sin volver a subir.
- `src/web/components/admin/AdminEvents.tsx`: `BulkPhotoUploader` se
  remonta (`key={selectedEventId}`) al cambiar de evento, igual que
  `GalleryEmailSender`/`EventPhotoManager` — antes de esta corrección no lo
  hacía y podía mezclar operaciones entre eventos.
- `src/web/adminApi.ts`: `requestPhotoUploads` en modo mock también deriva
  `photoId` de `operationId`.
- `scripts/test-aws-sandbox.mjs` y los scripts `scripts/deployed-*.mjs`/
  `scripts/test-aws-sandbox.mjs` que llaman a
  `POST /admin/events/{eventId}/photos/uploads`: añaden `operationId` al
  payload para seguir siendo válidos contra el nuevo esquema; el sandbox
  además repite la petición con el mismo `operationId` tras el PUT real y
  exige `COMPLETED` sin `uploadUrl`.

## Decisiones acordadas con la persona responsable antes de implementar

Confirmadas explícitamente antes de escribir código, como pedía el plan
aprobado del issue:

1. **Tombstone de borrado**: marcador ligero hasta la purga del evento
   (patrón del locator durable de selfies, ADR-014/ADR-013) en vez de
   verificar contra S3 en cada renovación.
2. **Verificación backend de resultados inciertos**: `HeadObjectCommand` en
   la Lambda antes de renovar/firmar, con el permiso IAM mínimo nuevo
   correspondiente; una vez confirmada la existencia del objeto, no se
   vuelve a firmar un PUT para esa operación (política de sobrescritura).

Ambas se documentan en detalle, con su razonamiento, en ADR-024.

## Validación

```text
npm run lint                   PASS
npm run typecheck               PASS
npm run test                     701 pruebas (lambdas + web + infra), todas
                                  en verde
npm run build                    PASS (web + 13 artefactos Lambda .js/.zip)
npm run terraform:format        PASS
npm run terraform:validate      PASS (7/7 roots; mismos avisos de
                                  deprecación de `aws_dynamodb_table`
                                  previos a esta entrega)
npm run terraform:test:hosting  PASS
npm run terraform:test:email    PASS
npm run terraform:test:findly-stack PASS
npm run security                 PASS
npm run sync:check               PASS
```

No se ejecuta `npm run test:e2e` (ningún flujo E2E existente cambia de
recorrido; la subida masiva no tiene aún un spec Playwright dedicado). El
sandbox persistente de `npm run test:aws` estaba destruido entre
ejecuciones (sin recursos en su state) cuando se intentó; la verificación
real se obtuvo en su lugar contra el entorno efímero de cada PR, con datos
sintéticos y limpieza automática al terminar — ver siguiente sección.

## Verificación real contra AWS (entorno efímero)

[PR #149](https://github.com/upc-malvaviscos/findly/pull/149) desplegó el
entorno efímero y
[corrió `deployed-issue-70-acceptance.mjs`](https://github.com/upc-malvaviscos/findly/actions/runs/39055842481)
contra AWS real, con dos commits:

1. El primer intento falló: `deployed-issue-70-acceptance.mjs` esperaba que
   la fila de DynamoDB de una foto borrada desapareciera por completo
   (contrato previo a esta issue), y ahora queda el tombstone a propósito.
   Corregido en el mismo PR, verificando contra AWS real el tombstone
   (`deletedAt`, sin `s3Key`/`fileName`) y el rechazo `PHOTO_DELETED` al
   reutilizar el `operationId` de la foto borrada.
2. El `auto-merge` del repositorio (`enable-automerge.yml`) fusionó el PR en
   cuanto ese run pasó — antes de que un tercer commit, que repetía una
   subida con el mismo `operationId` tras un PUT real para verificar la
   confirmación vía `HeadObjectCommand`, llegara a subirse. Ese commit se
   quedó sin ejecutar en la rama ya cerrada: el permiso IAM nuevo
   (`s3:GetObject`) nunca se verificó contra AWS real en ese momento.

[PR #150](https://github.com/upc-malvaviscos/findly/pull/150) (rama nueva
desde `main`, con ese único commit) desplegó el entorno efímero de nuevo y
[corrió la verificación pendiente](https://github.com/upc-malvaviscos/findly/actions/runs/39067525518)
contra AWS real: repetir la petición de subida con el mismo `operationId`
justo después del PUT real respondió `{ photoId, status: 'COMPLETED' }` sin
`uploadUrl` nueva, confirmando `HeadObjectCommand` y el permiso
`s3:GetObject` en un entorno desplegado real. Ambos PR se fusionaron tras
pasar todos sus checks (incluido `provision-test-destroy`), que destruye el
entorno al terminar.

## Pendiente

- **E2E Playwright de la subida masiva**: no existe hoy un spec dedicado a
  `BulkPhotoUploader`; esta entrega añade cobertura unitaria y de componente,
  pero no un recorrido E2E de reintento. Cubrirlo queda para una issue
  separada si se considera necesario, dado que la cobertura de componente ya
  ejercita el DOM real con React Testing Library.
- El sandbox persistente de `npm run test:aws` sigue sin un ciclo propio
  ejecutado para esta issue (quedó cubierto por el entorno efímero en su
  lugar); su extensión en `scripts/test-aws-sandbox.mjs` queda preparada
  para la próxima vez que ese sandbox esté desplegado.
- Issue #121 permanece abierta hasta sincronizar su comentario de cierre con
  este resultado.
