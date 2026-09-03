# 09 - Consentimiento, auditoría, retención de datos y derecho al olvido

## Objetivo
Garantizar el cumplimiento estricto del Reglamento General de Protección de Datos (GDPR), minimizando los datos biométricos, auditando el consentimiento y proporcionando mecanismos automatizados mediante AWS EventBridge Scheduler, DynamoDB TTL y Rekognition `DeleteFaces` para la purga y derecho al olvido.

## Requisitos de Consentimiento y Auditoría
- **Trazabilidad de Consentimiento**: Cada registro almacena la versión del texto legal aceptado, fecha/hora exacta en formato ISO-8601 (`consentTimestamp`), dirección IP/User-Agent anonimizados y alcance del propósito.
- **Minimización de Datos**: Prohibido almacenar imágenes originales de selfies de forma indefinida. Tras la indexación en Rekognition, la selfie original se elimina o se marca con ciclo de vida corto en S3.

## Política de Retención y Borrado Automático en AWS

### 1. DynamoDB TTL
- Todos los ítems de registro, fotos y matches incluyen el atributo `ttl` (epoch en segundos). DynamoDB elimina automáticamente los ítems caducados sin coste operativo.

### 2. S3 Lifecycle Rules
- Reglas automatizadas en los buckets S3 para expirar y purgar objetos al cumplirse el período de retención del evento (`retentionDays`).

### 3. Purga Automática via EventBridge Scheduler & Lambda `RetentionPurger`
- **Cron EventBridge Scheduler**: Ejecución programada diaria (`cron(0 3 * * ? *)` a las 3:00 AM UTC).
- Dispara la Lambda `RetentionPurger` (Memoria = `256 MB`, Timeout = `60 segundos`).
- Busca eventos vencidos (`date + retentionDays < hoy`), ejecuta `DeleteCollectionCommand` en Rekognition para eliminar la colección del evento y purga los objetos S3 restantes.

## Especificación del Derecho al Olvido (Right to Erasure)

### Flujo de Revocación de Consentimiento en Backend (`DELETE /registrations/{registrationId}`)
1. El usuario hace clic en "Eliminar mis datos biométricos" desde el pie de página de la galería o modal.
2. La API Gateway encamina la petición `DELETE /registrations/{registrationId}` a la Lambda `RightToErasureHandler`.
3. Acción en AWS Rekognition: Invocar `DeleteFacesCommand({ CollectionId: 'findly-event-' + eventId, FaceIds: [faceId] })`.
4. Acción en Amazon S3: Borrar el objeto selfie `events/{eventId}/selfies/{registrationId}.jpg`.
5. Acción en Amazon DynamoDB: Eliminar los registros `REG#{registrationId}`, `MATCH#*` y el token de galería asociado `TOKEN#{tokenHash}`.
6. Confirmación al usuario y registro de auditoría sin PII.

## Criterios de Aceptación
- Un test de revocación demuestra la eliminación completa verificable: borrado de la selfie en S3, eliminación de `FaceId` en Rekognition, purga de registros en DynamoDB y anulación del token de galería.
- Ningún dato personal o biométrico permanece accesible tras la ejecución del derecho al olvido.
