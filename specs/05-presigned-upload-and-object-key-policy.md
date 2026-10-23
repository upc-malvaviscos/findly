# 05 - Cargas prefirmadas y políticas de claves en S3

## Objetivo

Permitir la transferencia segura de imágenes directamente desde el navegador a buckets S3 privados mediante URLs `PUT` prefirmadas, sin exponer credenciales ni permisos de AWS al cliente web.

## Alineación con AWS Well-Architected Framework

- **Seguridad**: Bloqueo de acceso público S3 (`Block Public Access`), cifrado SSE-S3 (`AES256`), firma SigV4 y tiempo de expiración corto (5 min).
- **Eficiencia del Rendimiento**: Transferencia directa navegador -> S3 sin pasar por servidores o Lambdas intermediary para el payload binario.

## Especificación Técnica de S3 y Lambda

### Configuración del Bucket S3

- Bucket 100% privado con bloqueo de acceso público activado.
- Cifrado en reposo obligatorio con SSE-S3 (`AES256`).
- Configuración CORS restringida al origen exacto del frontend web (`var.frontend_domain_url`) para navegadores. CORS no es un mecanismo de autorización de la URL prefirmada.

### Reglas de URLs Prefirmadas (Lambda `PresignedUrlGenerator`)

- Configuración Lambda: `memory_size = 256`, `timeout = 3`.
- Método HTTP permitido: Únicamente `PUT`.
- Expiración: fotos 300 segundos (5 minutos); selfies hasta 300 segundos,
  limitada además por la caducidad del evento.
- Claves deterministas:
  - Selfies: `events/{eventId}/selfies/{registrationId}.selfie.jpg`
  - Fotos de evento: `events/{eventId}/photos/{photoId}.photo.jpg`

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Implementar el Generador de URLs en Lambda

- Usa `@aws-sdk/s3-request-presigner` y `PutObjectCommand` en Node.js 24.
- Configura `expiresIn: 300` y pasa el `ContentType` de la imagen.

### Paso 2: Crear el Helper Frontend (`uploadFileToS3`)

- En `src/lib/s3Uploader.ts`, escribe la función que usa `XMLHttpRequest` para emitir el evento `xhr.upload.onprogress`.

## Errores Comunes a Evitar (Pitfalls)

- ❌ **ERROR**: Discrepancia entre el `Content-Type` firmado por Lambda y el encabezado `Content-Type` enviado en el `PUT` de S3.
  - _Solución_: Deben ser **idénticos** (ej. `image/jpeg`). De lo contrario, S3 devolverá un error de firma 403 Forbidden.
- ❌ **ERROR**: Exponer permisos `s3:GetObject` públicos en el bucket.
  - _Solución_: El bucket debe permanecer estrictamente privado.

## Lista de Verificación Pre-PR (Junior Checklist)

- [x] La URL de fotos expira tras 5 minutos; una selfie nunca supera esa
      duración ni la caducidad del evento.
      _(Verificado con tests unitarios del presigner y registro público.)_
- [x] El bucket S3 esta configurado para permitir unicamente `PUT` desde el
      origen exacto del frontend, con cabeceras firmadas restringidas a
      `Content-Type` y `If-None-Match` para selfies de una sola escritura.
      _(Implementado en `infra/modules/uploads-bucket` y validado con
      `terraform validate`; la verificacion en vivo del rechazo de firma/CORS
      requiere un bucket desplegado, pendiente de la issue #11.)_
- [x] El bucket S3 tiene habilitado el cifrado en reposo SSE-S3.
      _(Implementado en `infra/modules/uploads-bucket`; no aplicado a AWS
      todavia — el modulo no esta conectado a una raiz Terraform real hasta
      que la issue #11 aporte el proveedor y el backend de estado.)_

**Actualización (issue #5):** `POST /admin/events/{eventId}/photos/uploads`
solo acepta `image/jpeg`, comprueba que el evento exista, escribe el metadato
`Photo` con TTL y firma una URL `PUT` con el mismo `Content-Type` y expiración
de 300 segundos. La subida binaria continúa yendo directamente de navegador a
S3; la Lambda no recibe la imagen.

## Actualización #70

[ADR-012](../docs/adr/ADR-012-distinct-s3-notification-suffixes.md) distingue
los filtros S3 de selfies y fotos. El presigner firma explícitamente
`content-type`; el test con SDK real inspecciona SignedHeaders. La prueba de
firma manipulada y CORS en AWS sigue pendiente hasta ejecutar su smoke.

La decisión aprobada de selfies inmutables (ADR-014) firma además
`If-None-Match: *` y exige esa cabecera en el cliente. El primer PUT crea el
objeto; una segunda escritura devuelve 412. Las fotos de organizador conservan
su contrato anterior. El smoke público comprueba omisión de cabecera firmada,
carga inicial y rechazo de sobrescritura en el origen real; está preparado,
no ejecutado en AWS.

<!-- requirement: REQ-PHOTO-UPLOAD-RETRY -->

## Reintento selectivo e identificador estable por operación (#121)

[ADR-024](../docs/adr/ADR-024-photo-upload-retry-and-stable-operation-id.md)
resuelve la duplicación de reintentos descrita en la issue
[#121](https://github.com/upc-malvaviscos/findly/issues/121):
`POST /admin/events/{eventId}/photos/uploads` exige ahora un `operationId`
(UUID) por archivo, generado una vez por el cliente y reenviado sin cambios en
cada reintento de ese mismo archivo. `photoId = operationId`; la clave S3 no
cambia (`events/{eventId}/photos/{photoId}.photo.jpg`).

Repetir la misma operación resuelve en uno de tres resultados, nunca en una
foto nueva: si S3 ya tiene el objeto (verificado con `HeadObjectCommand`, el
único permiso IAM nuevo y mínimo que añade esta issue), responde
`{ photoId, status: 'COMPLETED' }` sin firmar un nuevo PUT — un reintento
nunca sobrescribe una subida ya confirmada, y el 100 % de progreso del
cliente nunca sustituye esta confirmación; si el objeto no está en S3, renueva
firmando un PUT nuevo para la misma clave sin modificar el `ttl` ya
persistido (la renovación no amplía la retención); si el mismo `operationId`
llega con un `fileName` distinto, se rechaza con `409 OPERATION_MISMATCH` en
vez de mezclar la operación. `BulkPhotoUploader` (spec 04) solo reenvía los
archivos de un lote que no han completado, y nombres de archivo iguales no
colisionan porque cada operación tiene su propio `operationId`.

El borrado de foto (`DELETE .../photos/{photoId}`) deja un tombstone
(`deletedAt`, sin `s3Key` ni `fileName`) en vez de eliminar la fila, siguiendo
el mismo patrón que el locator durable de selfies (ADR-014/ADR-013): un
`operationId` reutilizado contra una foto borrada responde
`410`-equivalente (`error: 'PHOTO_DELETED'`) en vez de resucitarla, y el
tombstone no lleva TTL propio — se purga con el resto de la partición del
evento, sin ampliar la retención. `GET .../photos` excluye los tombstones del
listado.

Verificación:
[`docs/evidence/issue-121-photo-upload-retry.md`](../docs/evidence/issue-121-photo-upload-retry.md).

### Barrera de borrado antes de limpiar (#166)

El marcador de ADR-024 se persiste antes de leer espejos y limpiar matches.
`if_not_exists` conserva su fecha inicial y no cambia TTL. La transacción de
matching exige foto vigente sin `deletedAt`; el backfill omite marcadores.
La validación local se documenta en
[evidencia #166](../docs/evidence/issue-166-photo-matching-barrier.md);
aceptación AWS y despliegue pendientes. Esta spec y ADR-024 gobiernan reintentos:
no existe una spec 24 en el inventario actual del repositorio.
