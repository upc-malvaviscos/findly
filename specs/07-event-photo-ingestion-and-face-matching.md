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

> **Corrección de implementación (issue #8):** `SearchFacesByImageCommand`
> solo detecta y busca el rostro más prominente de la imagen de entrada
> (comportamiento documentado de Rekognition, no una opción de
> configuración). Para fotos de evento con varias personas — el caso
> normal, no la excepción — esta llamada dejaría sin intentar el resto de
> rostros presentes. La implementación usa en su lugar el patrón
> `IndexFacesCommand` (detecta e indexa temporalmente cada rostro de la
> foto) → `SearchFacesCommand` por `FaceId` para cada rostro detectado →
> `DeleteFacesCommand` de limpieza al finalizar, manteniendo intacta la
> confirmación por `GSI1` ya definida en el Paso 2 de esta spec como filtro
> de "es una inscripción real" (descarta rostros de otras fotos indexados
> temporalmente). Supone 3 llamadas a Rekognition por foto en lugar de 1.

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
- [x] Fotos con confianza >= 95% guardan la coincidencia en DynamoDB.
      *(Verificado con `aws-sdk-client-mock` en `photoMatcher.test.ts`.)*
- [x] Fotos sin coincidencias no generan registros `Match` erróneos.
      *(Cubre: sin rostros detectados, similitud por debajo del umbral,
      auto-coincidencia del rostro recién indexado consigo mismo, y rostro
      coincidente sin inscripción real en `GSI1`.)*
- [x] Ante fallos, SQS desvía el mensaje a la DLQ tras 3 reintentos.
      *(`maxReceiveCount = 3` configurado en
      `infra/modules/photo-matching`; la Lambda reporta fallos por mensaje
      individual vía `ReportBatchItemFailures`, verificado con test. La
      entrega real a la DLQ tras 3 reintentos requiere una cola
      desplegada, pendiente de la issue #11.)*
