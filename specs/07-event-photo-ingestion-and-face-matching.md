# 07 - Ingesta de fotos de evento y matching facial

## Objetivo

Procesar asíncronamente las fotografías publicadas por los fotógrafos/organizadores del evento mediante un patrón desacoplado S3 -> SQS -> Lambda, detectando todos los rostros presentes con AWS Rekognition y relacionándolos de forma segura con los asistentes inscritos que hayan otorgado su consentimiento.

## Alineación con AWS Well-Architected Framework

- **Fiabilidad**: Desacoplamiento de eventos S3 mediante Amazon SQS (`findly-photos-queue`) y Dead-Letter Queue (DLQ) para absorber picos masivos de fotos sin perder mensajes.
- **Eficiencia del Rendimiento**: Procesamiento por lotes en Lambda (`batch_size = 5`) y búsqueda vectorial acelerada con Rekognition `IndexFaces`, `SearchFaces` y limpieza `DeleteFaces`.

## Arquitectura de Desacoplamiento y Resiliencia (AWS Best Practices)

- **Pipeline**: `S3 Event` -> `SQS Queue` (`VisibilityTimeout = 180s`) -> `Lambda PhotoMatcher` (`512 MB`, `timeout = 30s`).
- **DLQ**: `findly-photos-dlq` con `maxReceiveCount = 3` y alarma CloudWatch.
  _(Issue #13: los nombres desplegados llevan sufijo de entorno —
  `findly-{env}-photos-queue`, `findly-{env}-photos-dlq` y
  `findly-{env}-photo-matcher`— y la alarma notifica al topic SNS de la spec 12.)_
- **Rekognition**: `IndexFacesCommand` temporal, `SearchFacesCommand` con
  `FaceMatchThreshold = 95.0` y limpieza `DeleteFacesCommand`.

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
> temporalmente). Supone una llamada de indexación, una búsqueda por cada rostro y una
> llamada final de limpieza; no son tres llamadas fijas por foto.

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Configurar el Consumidor SQS en Lambda

- En `src/lambdas/photoMatcher.ts`, itera sobre `event.Records` (mensajes SQS).
- Parsea el cuerpo JSON para obtener los datos del evento de S3 (`ObjectCreated:Put`).

### Paso 2: Indexar temporalmente, buscar cada rostro y consultar GSI1

- Por cada rostro detectado con similitud >= 95.0%, extrae el `faceId`.
- Realiza una consulta `Query` en DynamoDB sobre el `GSI1` usando `GSI1PK = FACE#{faceId}` para recuperar el `registrationId`.

### Paso 3: Guardar Coincidencia

- Escribe el registro `Match` en DynamoDB con `PK = REG#{registrationId}` y `SK = MATCH#{photoId}`.

## Errores Comunes a Evitar (Pitfalls)

- ❌ **ERROR**: Configurar el `VisibilityTimeout` de SQS menor que el `timeout` de la Lambda.
  - _Solución_: El `VisibilityTimeoutSeconds` de SQS debe ser al menos 6 veces mayor que el timeout de la Lambda (ej. SQS 180s vs Lambda 30s). De lo contrario, los mensajes se reprocesarán duplicados.
- ❌ **ERROR**: Guardar coincidencias con confianza menor al 95%.
  - _Solución_: Comprueba estrictamente `FaceMatch.Similarity >= 95.0`.

## Lista de Verificación Pre-PR (Junior Checklist)

- [x] Fotos con confianza >= 95% guardan la coincidencia en DynamoDB.
      _(Verificado con `aws-sdk-client-mock` en `photoMatcher.test.ts`.)_
- [x] Fotos sin coincidencias no generan registros `Match` erróneos.
      _(Cubre: sin rostros detectados, similitud por debajo del umbral,
      auto-coincidencia del rostro recién indexado consigo mismo, y rostro
      coincidente sin inscripción real en `GSI1`.)_
- [x] Terraform declara `maxReceiveCount = 3` y `ReportBatchItemFailures`;
      el handler tiene pruebas unitarias de fallo parcial.
- [ ] SQS entrega realmente el mensaje a DLQ tras tres recepciones fallidas
      (#46). No equivale a tres reintentos adicionales.

El módulo está conectado a `infra/modules/findly-stack` desde PR #64; el
root efímero del snapshot auditado no lo instanciaba. La entrega #70 de PR #71
lo conecta también al root efímero. #8 permanece abierta hasta la evidencia
AWS de #46. Véase [auditoría #70](../docs/evidence/issue-checklist-audit.md).

ADR-015 comparte `FINDLY_COLLECTION_NAMESPACE` entre PhotoMatcher,
SelfieIndexer y los handlers de limpieza. Las colecciones y los permisos IAM
se restringen al entorno; las colecciones legacy requieren inventario y
migración explícita antes de cualquier borrado.
