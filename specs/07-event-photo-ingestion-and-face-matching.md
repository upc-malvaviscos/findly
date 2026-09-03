# 07 - Ingesta de fotos de evento y matching facial

## Objetivo
Procesar asíncronamente las fotografías publicadas por los fotógrafos/organizadores del evento, detectando todos los rostros presentes mediante AWS Rekognition y relacionándolos de forma segura con los asistentes inscritos que hayan otorgado su consentimiento.

## Arquitectura del Pipeline de Matching

### Ingesta y Disparo Lambda
1. La carga de una foto de evento en `events/{eventId}/photos/{photoId}.jpg` dispara la Lambda de matching facial via eventos de S3.
2. La Lambda ejecuta la API `SearchFacesByImage` de AWS Rekognition sobre la colección del evento (`findly-collection-{eventId}`).
3. Umbral de Similitud: Configurado por defecto al **95.0%** (`FaceMatchThreshold`), definido como variable configurable en Terraform (`var.matching_threshold`).

### Persistencia de Coincidencias (DynamoDB)
- Para cada coincidencia por encima del umbral (95%), la Lambda escribe una entidad `Match` en DynamoDB con clave `PK = REG#{registrationId}` y `SK = MATCH#{photoId}`.
- Campos almacenados: `eventId`, `photoId`, `similarity` (ej: 98.42), `matchedAt` (ISO-8601), y `ttl` para purga automática.

### Resiliencia y Control de Errores
- Evaluación de cola SQS/DLQ: En caso de picos masivos de fotos subidas por administradores, los mensajes no procesados reintentan automáticamente y se desvían a una cola Dead-Letter Queue (DLQ) con alarma CloudWatch.

## Criterios de Aceptación
- Una foto de evento con coincidencia >= 95% crea el registro `Match` correspondiente en DynamoDB asociándolo al asistente.
- Si no hay coincidencias o el nivel de confianza es < 95%, no se crean registros de coincidencia ni se genera token de galería vacía.
- La ejecución ante imágenes masivas o corruptas no interrumpe el pipeline y queda registrada con su identificador de correlación.
