# ADR-024: identificador estable por operación, tombstone y verificación backend para reintentos de subida (#121)

- Estado: aceptado por la persona responsable el 2026-10-17.
- Issue: [#121](https://github.com/upc-malvaviscos/findly/issues/121).

## Contexto

`requestPhotoUploads` (`src/lambdas/adminEvents.ts`) generaba
`photoId = randomUUID()` en cada llamada a
`POST /admin/events/{eventId}/photos/uploads`. Repetir una subida —incluida
una llamada idéntica tras un timeout de red— creaba un `photoId`/clave S3
nuevos en vez de reutilizar la operación original, duplicando registros y
procesamiento. Un error de red tampoco demostraba que la subida hubiera
fallado: S3 podía haber recibido el archivo aunque la respuesta se perdiera.
`BulkPhotoUploader.tsx` tampoco distinguía archivos completados de
pendientes al reintentar: reenviaba todo el lote en memoria.

El plan aprobado del issue pedía acordar y documentar explícitamente, antes
de implementarlas, la verificación backend de resultados inciertos y la
política de sobrescritura. Este ADR fija esas dos decisiones junto con el
identificador estable y el tombstone de borrado que las sostienen.

## Decisión

### Identificador estable por operación

Cada archivo de un lote incluye un `operationId` (UUID) generado una vez por
el cliente al seleccionar el archivo y reenviado sin cambios en cada
reintento de ese mismo archivo. `photoId = operationId`: la clave S3
determinista de spec 05 (`events/{eventId}/photos/{photoId}.photo.jpg`) no
cambia. Dos archivos con el mismo nombre nunca colisionan, porque cada uno
tiene su propio `operationId`.

### Resolución idempotente en el backend

`createPhotoUploads` resuelve cada archivo del lote de forma independiente:

1. Intenta crear el ítem `Photo` con `ConditionExpression:
attribute_not_exists(PK)`. Si tiene éxito (primera vez), firma un PUT
   nuevo como hasta ahora.
2. Si el ítem ya existe (reintento, petición concurrente duplicada, o
   renovación), lee el ítem existente:
   - Si tiene `deletedAt` (tombstone, ver más abajo), responde
     `{ photoId, error: 'PHOTO_DELETED' }` sin firmar nada.
   - Si su `fileName` no coincide con el de la petición, responde
     `{ photoId, error: 'OPERATION_MISMATCH' }`: reutilizar el identificador
     con datos incompatibles se rechaza explícitamente en vez de mezclar la
     operación.
   - En otro caso, verifica S3 (ver siguiente sección) para decidir entre
     confirmar o renovar.

### Verificación backend de resultados inciertos

Antes de volver a firmar un PUT para una operación ya conocida, la Lambda
ejecuta `HeadObjectCommand` contra la clave determinista en el bucket de
fotos:

- Si el objeto **ya existe** en S3, la subida anterior tuvo éxito aunque el
  cliente nunca viera esa respuesta (error de red, timeout). Responde
  `{ photoId, status: 'COMPLETED' }` **sin firmar un nuevo PUT**. El 100 % de
  progreso reportado por el cliente nunca sustituye esta confirmación; solo
  esta verificación, o una respuesta 2xx real de S3 en el momento del PUT,
  cuentan como confirmación.
- Si el objeto **no existe**, renueva: firma un PUT nuevo para la misma
  clave sin modificar el `ttl` ya persistido en el ítem (ver política de
  retención más abajo).

Esto añade el único permiso IAM nuevo de esta issue: `s3:GetObject` (cubre
`HeadObject`) acotado al mismo prefijo que ya usa `s3:PutObject`
(`events/*/photos/*` del bucket de subidas), sin leer nunca el contenido de
la imagen.

### Política de sobrescritura

Una vez que el backend confirma la existencia del objeto (`COMPLETED`), **no
se vuelve a firmar un PUT para ese `operationId`**: una subida confirmada
nunca se sobrescribe por un reintento posterior. Mientras no haya
confirmación, volver a firmar un PUT para la misma clave es seguro porque el
cliente reenvía el mismo `File` — el contenido esperado es idéntico — y evita
crear una foto nueva.

### Tombstone de borrado y retención

`deleteEventPhoto` deja un ítem marcador (`deletedAt`, con `s3Key` y
`fileName` eliminados) en vez de borrar la fila por completo, siguiendo el
mismo patrón que el locator durable de selfies (ADR-014/ADR-013). Un
`operationId` reutilizado contra una foto borrada se rechaza
(`PHOTO_DELETED`) en vez de resucitarla silenciosamente. El tombstone no
lleva TTL propio: se purga junto con el resto de la partición del evento
(`EVENT#{eventId}`) cuando el evento se elimina, igual que cualquier otro
ítem de esa partición. `listEventPhotos` excluye los tombstones del listado
(`FilterExpression: attribute_not_exists(deletedAt)`).

Una renovación tampoco modifica el `ttl` ya persistido en el ítem: solo la
creación inicial lo fija. Ni renovar ni borrar amplían la retención
acordada para la foto.

### Frontend

`BulkPhotoUploader` guarda `operationId` y un estado explícito
(`pending`/`uploading`/`completed`/`failed`) por archivo. Reintentar un lote
solo reenvía los archivos que no quedaron `completed`. Un resultado
`COMPLETED` marca el archivo como subido sin repetir el `PUT`. El componente
se remonta (`key={eventId}`) al cambiar de evento seleccionado — el mismo
patrón que ya usan `GalleryEmailSender` y `EventPhotoManager` — para que
cambiar de evento no mezcle operaciones. Se mantiene el máximo de tres
subidas simultáneas (spec 04); recuperar subidas tras recargar la página
sigue fuera de alcance, igual que en el plan aprobado del issue.

## Qué no decide este ADR

- No implementa deduplicación por contenido ni matching histórico.
- No cambia el contrato de selfies (`If-None-Match: *`, ADR-014): las fotos
  de organizador conservan su contrato de escritura previo salvo por la
  idempotencia de `operationId` descrita aquí.
- No introduce un paso de reconciliación asíncrono ni un cron nuevo: la
  verificación ocurre en línea, dentro de la misma petición de renovación.

## Evidencia

Unitarias (`tests/lambdas/adminEvents.test.ts`): creación, renovación sin
tocar `ttl`, confirmación vía `HeadObjectCommand` sin volver a firmar,
rechazo por `fileName` incompatible, rechazo de tombstone, resolución
independiente por archivo en un mismo lote, exclusión de tombstones en el
listado. Componente (`tests/web/bulkPhotoUploader.test.tsx`): reintento
selectivo, nombres de archivo iguales como operaciones distintas,
confirmación backend sin reintentar el PUT, máximo de tres subidas
simultáneas. E2E (`e2e/foundation.spec.ts`, [PR #152](https://github.com/upc-malvaviscos/findly/pull/152)):
lote con un archivo cuyo primer PUT falla, reintento selectivo que solo
reenvía ese archivo y conserva el mismo `operationId`, verificado contra
Playwright real. AWS real (entorno efímero de PR, `deployed-issue-70-acceptance.mjs`):
tombstone y rechazo `PHOTO_DELETED` verificados en
[PR #149](https://github.com/upc-malvaviscos/findly/pull/149); confirmación
`COMPLETED` vía `HeadObjectCommand` sin firmar URL nueva, verificando el
permiso `s3:GetObject` nuevo, en
[PR #150](https://github.com/upc-malvaviscos/findly/pull/150). Detalle
completo en
[`docs/evidence/issue-121-photo-upload-retry.md`](../evidence/issue-121-photo-upload-retry.md).
