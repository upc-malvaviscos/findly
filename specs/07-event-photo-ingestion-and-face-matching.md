# 07 - Ingesta de fotos de evento y matching facial

## Objetivo
Procesar asíncronamente las fotografías publicadas por los fotógrafos/organizadores del evento mediante un patrón desacoplado S3 -> SQS -> Lambda, detectando todos los rostros presentes con AWS Rekognition y relacionándolos de forma segura con los asistentes inscritos que hayan otorgado su consentimiento.

## Arquitectura de Desacoplamiento y Resiliencia (AWS Best Practices)

### Pipeline de Eventos: S3 -> SQS -> Lambda
1. La carga de fotos en `events/{eventId}/photos/{photoId}.jpg` genera un evento `ObjectCreated:Put` en S3.
2. S3 envía una notificación a la cola de Amazon SQS `findly-photos-queue-${var.environment}`.
3. La Lambda `PhotoMatcher` consume los mensajes de SQS en lotes (`batch_size = 5`).
4. **Cola Dead-Letter (DLQ)**: Configurada `findly-photos-dlq-${var.environment}` con `maxReceiveCount = 3` y alarma CloudWatch asociada para capturar mensajes no procesados tras fallos persistentes.

### Configuración de Servicios AWS
- **Lambda `PhotoMatcher`**: Memoria = `512 MB`, Timeout = `30 segundos`.
- **SQS Queue**: `VisibilityTimeoutSeconds = 180` (6 veces el timeout de la Lambda para evitar duplicidad durante la ejecución).
- **Retención SQS**: `14 días` (`MessageRetentionSeconds = 1209600`).

### Invocación Rekognition `SearchFacesByImage`
- Parámetros de `SearchFacesByImageCommand`:
  - `CollectionId`: `findly-event-{eventId}`
  - `FaceMatchThreshold`: `95.0` (configurable vía variable Terraform `var.matching_threshold`).
  - `MaxFaces`: `50` (para soportar fotos grupales).

### Persistencia de Coincidencias (DynamoDB)
- Por cada rostro coincidente devuelto por Rekognition con similitud >= 95%, la Lambda consulta el `registrationId` en el `GSI1` usando `GSI1PK = FACE#{faceId}`.
- Escribe una entidad `Match` en DynamoDB con `PK = REG#{registrationId}` y `SK = MATCH#{photoId}`.
- Campos almacenados: `eventId`, `photoId`, `similarity` (ej: 98.42), `matchedAt` (ISO-8601), y `ttl` para purga automática.

## Criterios de Aceptación
- Una foto de evento con coincidencia >= 95% crea el registro `Match` correspondiente en DynamoDB asociándolo al asistente.
- Si no hay coincidencias o el nivel de confianza es < 95%, no se crean registros de coincidencia.
- Ante fallos de red o de Rekognition, SQS reintenta automáticamente hasta 3 veces antes de desviar el mensaje a la DLQ de forma observable.
