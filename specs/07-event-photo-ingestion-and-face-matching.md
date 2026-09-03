# 07 - Ingesta de fotos de evento y matching facial

## Objetivo
Procesar asíncronamente las fotografías publicadas por los fotógrafos/organizadores del evento mediante un patrón desacoplado S3 -> SQS -> Lambda, detectando todos los rostros presentes con AWS Rekognition y relacionándolos de forma segura con los asistentes inscritos que hayan otorgado su consentimiento.

## Alineación con AWS Well-Architected Framework
- **Fiabilidad**: Desacoplamiento de eventos S3 mediante Amazon SQS (`findly-photos-queue`) y Dead-Letter Queue (DLQ) para absorber picos masivos de fotos sin perder mensajes.
- **Eficiencia del Rendimiento**: Procesamiento por lotes en Lambda (`batch_size = 5`) y búsqueda vectorial acelerada con Rekognition `SearchFacesByImage`.

## Arquitectura de Desacoplamiento y Resiliencia (AWS Best Practices)
- **Pipeline**: `S3 Event` -> `SQS Queue` (`VisibilityTimeout = 180s`) -> `Lambda PhotoMatcher` (`512 MB`, `timeout = 30s`).
- **DLQ**: `findly-photos-dlq` con `maxReceiveCount = 3` y alarma CloudWatch.
- **Rekognition**: `SearchFacesByImageCommand` con `FaceMatchThreshold = 95.0` y `MaxFaces = 50`.

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Configurar el Consumidor SQS en Lambda
- En `build/lambdas/matcher/index.ts`, itera sobre `event.Records` (mensajes SQS).
- Parsea el cuerpo JSON para obtener los datos del evento de S3 (`ObjectCreated:Put`).

### Paso 2: Invocar SearchFacesByImage y Consultar GSI1
- Por cada rostro detectado con similitud >= 95.0%, extrae el `faceId`.
- Realiza una consulta `Query` en DynamoDB sobre el `GSI1` usando `GSI1PK = FACE#{faceId}` para recuperar el `registrationId`.

### Paso 3: Guardar Coincidencia
- Escribe el registro `Match` en DynamoDB con `PK = REG#{registrationId}` y `SK = MATCH#{photoId}`.

## Errores Comunes a Evitar (Pitfalls)
- ❌ **ERROR**: Configurar el `VisibilityTimeout` de SQS menor que el `timeout` de la Lambda.
  - *Solución*: El `VisibilityTimeoutSeconds` de SQS debe ser al menos 6 veces mayor que el timeout de la Lambda (ej. SQS 180s vs Lambda 30s). De lo contrario, los mensajes se reprocesarán duplicados.
- ❌ **ERROR**: Guardar coincidencias con confianza menor al 95%.
  - *Solución*: Comprueba estrictamente `FaceMatch.Similarity >= 95.0`.

## Lista de Verificación Pre-PR (Junior Checklist)
- [ ] Fotos con confianza >= 95% guardan la coincidencia en DynamoDB.
- [ ] Fotos sin coincidencias no generan registros `Match` erróneos.
- [ ] Ante fallos, SQS desvía el mensaje a la DLQ tras 3 reintentos.
