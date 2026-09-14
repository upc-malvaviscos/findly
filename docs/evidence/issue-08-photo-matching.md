# Evidencia de ingesta de fotos de evento y matching facial

Implementación de la spec 07 (issue #8): pipeline S3 → SQS → Lambda que
detecta todos los rostros de cada foto de evento subida y los relaciona con
los asistentes inscritos mediante AWS Rekognition y la clave `GSI1` de
DynamoDB.

## Alcance verificado

- `src/shared/lib/s3Keys.ts`: `parseEventPhotoObjectKey` recupera
  `{eventId, photoId}` a partir de una clave S3, inverso de
  `eventPhotoObjectKey` (issue #6).
- `src/shared/lib/dynamoKeys.ts`: `faceGsi1PartitionKey` (consulta `GSI1`
  por `faceId`) y `parseRegistrationId` (extrae el `registrationId` del
  `GSI1SK` devuelto, válido bajo cualquier tipo de proyección del índice ya
  que las claves siempre se devuelven).
- `src/shared/lib/rekognitionCollections.ts`: `eventCollectionId` — la
  convención `findly-event-{eventId}`, compartida con la futura
  `SelfieIndexer` (issue #7, no implementada todavía).
- `src/lambdas/photoMatcher.ts`: handler disparado por SQS. Corrige una
  laguna real de la spec 07 (ver nota añadida directamente en la spec):
  `SearchFacesByImageCommand` solo detecta el rostro más prominente de la
  imagen, por lo que fallaría silenciosamente en cualquier foto de grupo.
  Se implementa en su lugar `IndexFaces` (detecta todos los rostros e
  indexa temporalmente) → `SearchFaces` por `FaceId` de cada rostro
  detectado → `DeleteFaces` de limpieza en un bloque `finally` (se ejecuta
  incluso si el matching lanza una excepción). La confirmación de "es una
  inscripción real" sigue exactamente el Paso 2 de la spec: consulta
  `GSI1` por `FACE#{faceId}`, descartando así tanto auto-coincidencias
  como rostros de otras fotos indexados temporalmente.
  - Escrituras de `Match` idempotentes (`ConditionExpression:
    attribute_not_exists(PK)`), tolerando reentregas de SQS sin duplicar.
  - Devuelve `batchItemFailures` (formato de fallo parcial de lote SQS) para
    que un mensaje problemático no fuerce el reintento de sus 4
    acompañantes de lote.
  - TTL de los registros `Match` fijado a 30 días (constante local), en
    línea con la política de retención MVP ya documentada en el resto del
    producto; no consulta el `retentionDays` propio del evento — ver
    Pendiente.
- `infra/modules/photo-matching/`: cola `findly-photos-queue`
  (`visibility_timeout = 180s`, 6× el timeout de la Lambda) + DLQ
  `findly-photos-dlq` (`maxReceiveCount = 3`) + alarma CloudWatch sobre la
  DLQ, rol IAM de mínimo privilegio (Rekognition limitado a
  `collection/findly-event-*`, DynamoDB limitado a la tabla y al índice
  `GSI1`, S3 limitado al prefijo `events/*/photos/*`), Lambda (512 MB/30s,
  runtime `nodejs22.x` — el README fija Node.js 22 para las Lambdas
  gestionadas por AWS, distinto del Node 24 usado en tooling/CI local),
  `aws_lambda_event_source_mapping` con `batch_size = 5` y
  `ReportBatchItemFailures`, y el `aws_s3_bucket_notification` que conecta
  el bucket de subidas (issue #6) a la cola.
  Deliberadamente no conectado a una raíz Terraform real (mismo motivo que
  la issue #6: `infra/main.tf` no tiene `provider "aws"` aún — issue #11).

## Hallazgo de arquitectura para la issue #7 (importante)

`aws_s3_bucket_notification` es un recurso **singleton por bucket**: una
segunda declaración independiente para el mismo bucket sobrescribiría esta
configuración en vez de sumarse a ella. Como selfies y fotos de evento
comparten un único bucket (decisión de la issue #6), y S3 solo filtra
notificaciones por prefijo/sufijo (no por segmento intermedio de la
clave), **la issue #7 (SelfieIndexer) debe extender el recurso
`aws_s3_bucket_notification.uploads` ya creado en
`infra/modules/photo-matching/main.tf`** añadiendo su propio bloque
`lambda_function {}`, en vez de crear un recurso nuevo. Ambos consumidores
recibirán eventos de selfies y de fotos indistintamente; cada Lambda debe
ignorar en silencio las claves que no le correspondan (`photoMatcher.ts`
ya lo hace vía `parseEventPhotoObjectKey`). Documentado también como
comentario inline en el propio `main.tf`.

## Pendiente

- El TTL de `Match` usa una constante de 30 días en vez de leer
  `retentionDays` del `Event` correspondiente (que sí es configurable por
  evento según la spec 02). Añadir esa lectura implicaría un `GetCommand`
  adicional por foto; se deja como mejora futura, no bloqueante para el
  MVP.
- El módulo Terraform no está desplegado; la verificación en vivo del
  desvío a DLQ tras 3 reintentos y de la alarma CloudWatch queda pendiente
  de un entorno real (issue #11).
- Esta Lambda asume que los rostros de los asistentes inscritos ya están
  indexados en la colección `findly-event-{eventId}` — eso es
  responsabilidad de la issue #7 (`SelfieIndexer`), no implementada
  todavía. No hay forma de probar el pipeline de extremo a extremo hasta
  que ambas existan.
- La escritura de la entidad `Photo` en DynamoDB (con su propio `s3Key` y
  `uploadedAt`) es responsabilidad del flujo de subida administrativa
  (issue #5, no implementada); `photoMatcher.ts` no la lee ni la escribe,
  ya que deriva `eventId`/`photoId` directamente de la clave S3 del evento
  entrante.
- No se abre ADR nuevo: la corrección del patrón de matching es
  implementación de lo ya definido en la spec 07 (su propio Paso 2 de
  confirmación por `GSI1`), no una decisión arquitectónica nueva de alto
  nivel.

## Mensajes sugeridos para otras issues

### Issue #7 (Inscripción facial)

> Nota de la issue #8: el recurso `aws_s3_bucket_notification.uploads` en
> `infra/modules/photo-matching/main.tf` ya conecta el bucket de subidas
> (issue #6) a la cola de fotos. Es un recurso singleton por bucket — al
> implementar el trigger S3→Lambda de `SelfieIndexer`, añade un bloque
> `lambda_function {}` adicional a ESE MISMO recurso en vez de crear uno
> nuevo, o la segunda declaración independiente sobrescribiría la primera.
> Además, dado que S3 solo filtra por prefijo/sufijo (ambas claves
> comparten `events/` y `.jpg`), tu Lambda recibirá también eventos de
> fotos de evento — ignóralos con seguridad si la clave no coincide con el
> patrón de selfie. También puedes reutilizar
> `src/shared/lib/rekognitionCollections.ts` (`eventCollectionId`) para la
> convención de nombre de colección `findly-event-{eventId}`, ya usada por
> `photoMatcher.ts`.

### Issue #5 (Administración y Cognito)

> Nota de la issue #8: `src/lambdas/photoMatcher.ts` deriva `eventId` y
> `photoId` directamente de la clave S3 entrante
> (`events/{eventId}/photos/{photoId}.jpg`), no de un registro `Photo` en
> DynamoDB. Al implementar la subida masiva de fotos del organizador,
> recuerda igualmente escribir la entidad `Photo` (`PK=EVENT#{eventId}`,
> `SK=PHOTO#{photoId}`, con `s3Key`/`uploadedAt`/`ttl`) — la usa
> `src/lambdas/gallery.ts` para resolver la URL de cada foto en la galería
> privada del asistente.

## Validación

```text
npm run typecheck            PASS
npm run lint:code             PASS
npm run lint:markdown         PASS
npm run test                  PASS (63 tests, 15 archivos; 11 nuevos en
                               photoMatcher.test.ts)
npm run build                  PASS (web + lambdas + verificación de
                               artefactos; photoMatcher.js se empaqueta
                               como artefacto Lambda independiente)
terraform validate (módulo)    PASS (infra/modules/photo-matching,
                               validado de forma independiente)
npm run terraform:format       PASS (recursivo, incluye el módulo)
npm run terraform:validate     PASS (raíz infra/, sin cambios)
npm run security                PASS (0 vulnerabilidades en dependencias de
                               producción; @aws-sdk/client-rekognition
                               añade únicamente vulnerabilidades de
                               devDependencies transitivas, fuera del
                               alcance de `npm audit --omit=dev`)
npm run sync:check              PASS
```

No se ejecuta `npm run test:e2e`: ningún flujo de usuario visible cambia
en esta issue (trabajo exclusivamente backend/infraestructura).
