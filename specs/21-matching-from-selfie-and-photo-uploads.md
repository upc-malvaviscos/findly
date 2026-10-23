# 21 - Matching al subir selfies y fotografías del evento

<!-- requirement: REQ-MATCHING-BOTH-ORDERS -->

## Objetivo

Encontrar coincidencias independientemente del orden de las subidas: foto
nueva contra inscripciones ya `ENROLLED`, y selfie recién inscrita contra
fotos ya disponibles del evento. Continúa spec 07/#8, que ya acredita el
matching provocado por fotos; no la duplica ni la reabre. Ningún trigger
envía emails: spec 20 reserva el envío al botón administrativo.

## Estado y límites

Implementación de la issue
[#87](https://github.com/upc-malvaviscos/findly/issues/87) (código +
Terraform + pruebas unitarias/contrato), **más aceptación AWS efímera real**
de los tres órdenes de subida (2026-10-14) y de los tres criterios que
seguían pendientes (2026-10-16): sandbox desplegado, los seis escenarios
(A-F) ejecutados contra Rekognition/DynamoDB/SQS reales con
`scripts/deployed-issue-87-acceptance.mjs`, y stack destruido con las 20
colecciones Rekognition creadas por los handlers a lo largo de las dos
sesiones borradas explícitamente, una a una. Véase la
[evidencia](../docs/evidence/issue-87-matching-convergence.md) para el
detalle, incluidos dos hallazgos reales: el trigger S3 falla su primer
intento si ningún selfie ha sido indexado todavía para el evento (el
backfill converge); y el escenario "otro evento" solo demuestra aislamiento
real de colecciones si esa otra colección existe de verdad (una colección
ausente rechaza `IndexFaces` con `ResourceNotFoundException`, lo que daría un
falso positivo si el otro evento no tuviera ninguna selfie inscrita). Los
nueve criterios de aceptación de la issue quedan acreditados con AWS real. El
benchmark de fan-out de #49 se ejecutó el 2026-10-16 y esa issue está
cerrada; ver su evidencia. El envío del backfill sigue siendo best-effort,
sin Transactional Outbox. La protección posterior entre tombstone de foto y matching se implementa
en #166 con pruebas locales; su aceptación AWS específica sigue pendiente.

## Alineación con AWS Well-Architected Framework

- **Fiabilidad**: reentrega idempotente (misma condición `attribute_not_exists(PK)`
  que ya usa el match provocado por fotos) y convergencia de subidas
  simultáneas sin coordinación explícita entre los dos triggers.
- **Seguridad**: el backfill solo actúa sobre inscripciones `ENROLLED` sin
  `erasureRequestedAt` y con `ttl` vigente; aislamiento por colección de
  Rekognition por entorno (ADR-015), sin cambios.
- **Optimización de Costes**: paginación acotada (25 fotos por invocación) y
  reutilización íntegra del núcleo de matching existente; un doble disparo
  sobre la misma foto cuesta una llamada Rekognition adicional, no un match
  duplicado.

## Dependencias

Specs 02 (contrato de claves, actualizado), 06, 07, 09, 20; ADR-013/014/015 y
ADR-022 (decisión de persistencia y contrato de backfill que gobierna esta
spec). Bloqueada por #49 para el contrato de persistencia — ya resuelto por
ADR-022 — y coordinada, sin bloquear, con #86/#88/#89.

## Arquitectura implementada

- **Núcleo de matching compartido** (`src/lambdas/lib/matching.ts`): extrae
  `matchPhoto`, `writeMatch` y `findRegistrationForFace` de `photoMatcher.ts`
  sin cambiar su comportamiento. Ambos triggers —la subida de foto (spec 07)
  y el backfill de esta spec— llaman exactamente a la misma función.
- **Trigger de backfill** (`src/lambdas/registrationBackfill.ts`): tras la
  transición a `ENROLLED` con `faceId` persistido, `selfieIndexer.ts` encola
  `{ eventId, registrationId }` en una cola SQS nueva
  (`findly-{env}-backfill-queue`). El consumidor:
  1. Revalida que la inscripción siga `ENROLLED`, con `faceId`, sin
     `erasureRequestedAt` y con `ttl` vigente; si no, no hace nada (opera
     como optimización de coste, no como única garantía: `matchPhoto`
     vuelve a resolver y revalidar la inscripción por cada rostro
     encontrado).
  2. `Query PK = EVENT#{eventId}, SK begins_with PHOTO#` (lectura fuerte,
     página de 25 fotos), ignorando tombstones, fotos sin clave S3 válida y filas cuyo `ttl` falta
     o ya expiró.
  3. Llama `matchPhoto` por cada foto de la página.
  4. Si `LastEvaluatedKey` está presente, reencola la continuación con el
     cursor; si no, termina.
- **Convergencia**: el envío de backfill es best-effort — un fallo al
  encolar no revierte la transición `ENROLLED` ni se reintenta contra la
  inscripción, porque las fotos subidas después de `ENROLLED` siguen
  matcheando por el trigger S3 normal. La idempotencia de `writeMatch` (ya
  existente) es la única garantía de que ambos triggers no dupliquen un
  match; no se añadió coordinación adicional entre colas.
- **Terraform**: módulo nuevo `infra/modules/registration-backfill/`
  (cola + DLQ + alarma + Lambda + IAM de mínimo privilegio, mismo patrón que
  `photo-matching`). `selfie-indexer` recibe `sqs:SendMessage` solo hacia
  esta cola, vía variables opcionales `backfill_queue_arn`/`backfill_queue_url`
  (`null` por defecto: el trigger queda desactivado si el módulo no se
  despliega). Wiring en `findly-stack` y en el root efímero de CI.

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Extraer el núcleo de matching sin cambiar su comportamiento

- Mueve `matchPhoto`/`writeMatch`/`findRegistrationForFace` y sus clientes
  AWS a `src/lambdas/lib/matching.ts`; `photoMatcher.ts` pasa a importarlos.
  Las pruebas existentes de `photoMatcher.test.ts` deben seguir pasando sin
  modificarlas: es la señal de que la extracción no cambió el contrato.

### Paso 2: Encolar el backfill solo tras `ENROLLED`

- En `selfieIndexer.ts`, tras la escritura que fija `status = 'ENROLLED'` y
  persiste `faceId`, envía `{ eventId, registrationId }` a
  `FINDLY_BACKFILL_QUEUE_URL`. Nunca en la rama `FAILED`. Un fallo al
  encolar se registra pero no revierte la inscripción.

### Paso 3: Paginar las fotos existentes del evento

- En `registrationBackfill.ts`, usa `Query` sobre la clave primaria
  (`PK = EVENT#{eventId}`, `begins_with(SK, 'PHOTO#')`), nunca `Scan`.
  Acota la página (`Limit`) y reencola con `ExclusiveStartKey` si
  `LastEvaluatedKey` está presente.

### Paso 4: Revalidar antes de gastar Rekognition

- Antes de paginar, confirma con una lectura fuerte que la inscripción
  disparadora sigue `ENROLLED`/vigente. No es la única barrera: `matchPhoto`
  vuelve a confirmarlo por cada rostro que encuentra.

## Errores Comunes a Evitar (Pitfalls)

- ❌ **ERROR**: Comparar antes de completar indexación, o asumir que la
  selfie siempre llega antes que la foto.
  - _Solución_: el backfill cubre exactamente el caso contrario: fotos ya
    indexadas/matcheadas antes de que la selfie exista.
- ❌ **ERROR**: Duplicar matches al converger ambos triggers.
  - _Solución_: no se añadió deduplicación nueva; se reutiliza la condición
    `attribute_not_exists(PK)` que ya tenía `writeMatch`.
- ❌ **ERROR**: Indexar permanentemente caras de fotos para poder buscarlas
  más tarde.
  - _Solución_: el backfill no depende de un índice persistente de caras de
    fotos — vuelve a indexar y borrar la cara temporal de cada foto, igual
    que el trigger S3 original.
- ❌ **ERROR**: Presentar las pruebas unitarias con `aws-sdk-client-mock`
  como evidencia de aceptación AWS real.
  - _Solución_: véase la sección "Estado y límites"; esa evidencia sigue
    pendiente y requiere autorización explícita para desplegar y ejecutar
    contra AWS real.

## Lista de Verificación Pre-PR (Junior Checklist)

- [x] Selfie antes de foto sigue matcheando por el trigger S3 existente, sin
      regresión (`photoMatcher.test.ts`, 21 pruebas).
- [x] Foto antes de selfie: el backfill matchea sin resubir la fotografía
      (`registrationBackfill.test.ts`).
- [x] Duplicados/reintentos no multiplican matches: cubierto por la condición
      de escritura idempotente ya existente; no se reintrodujo lógica nueva
      de deduplicación que pudiera romperla.
- [x] Paginación probada con continuación de cursor
      (`registrationBackfill.test.ts`).
- [x] Revocación/caducidad/inscripción borrada no produce backfill
      (`registrationBackfill.test.ts`, casos `FAILED`/sin `faceId`/
      `erasureRequestedAt`/`ttl` expirado/inscripción ausente).
- [x] Fotos cuyo propio `ttl` ya expiró no se procesan en el backfill.
- [x] El backfill nunca registra `registrationId` en logs, solo `eventId` y
      un contador de fotos (`registrationBackfill.test.ts`, sección de
      logging estructurado).
- [x] `npm run lint`, `npm run test` (626 pruebas), `npm run build` y
      `npm run verify` (incluye `terraform:validate` y las pruebas Terraform
      de `findly-stack`) en verde con este cambio.
- [x] Subidas simultáneas convergen sin intervención administrativa —
      verificado con AWS real (2026-10-14): selfie y foto lanzadas en
      paralelo, un único `Match` persistido. Detalle en
      [docs/evidence/issue-87-matching-convergence.md](../docs/evidence/issue-87-matching-convergence.md).
- [x] Aceptación AWS efímera con teardown de los tres órdenes de subida de
      #87 (selfie→foto, foto→selfie, simultáneo): sandbox desplegado,
      ejecutado con `scripts/deployed-issue-87-acceptance.mjs` y destruido
      (117 recursos, colecciones Rekognition borradas explícitamente).
- [x] Sin rostro, bajo umbral y otro evento no generan coincidencias
      incorrectas — **AWS real (2026-10-16)**: foto sin rostro detectable,
      foto de una segunda cara sintética distinta y foto de la misma cara en
      otro evento cuya colección Rekognition fue poblada de antemano con una
      tercera persona (para que el `null` acredite aislamiento real, no una
      colección ausente). Los tres produjeron cero matches. Detalle en
      [issue-87-matching-convergence.md](../docs/evidence/issue-87-matching-convergence.md),
      escenario D.
- [x] Paginación y límites probados con varias páginas de datos — **AWS
      real**: 26 fotos (una más que `PHOTO_PAGE_SIZE`), 26 matches y dos
      invocaciones reales de `registration-backfill` confirmadas por log
      (`photoCount: 25` y `photoCount: 1`), escenario E.
- [x] Revocación/caducidad/borrado concurrente no resucita matches — **AWS
      real**: `DELETE` de la inscripción lanzado en paralelo con la subida
      de su foto coincidente deja cero matches tras la carrera, y una
      inscripción con `ttl` expirado manualmente no matchea una foto subida
      después, escenario F.
- [x] Spec 07, ADR, evidencia e issue #87 sincronizados — esta entrega añade
      la aceptación AWS real de los tres criterios restantes y sincroniza
      esta spec, la evidencia y un comentario en la issue #87. #49 conserva
      su benchmark de coste/capacidad propio, pendiente e independiente.

## Protocolo de fotografía activa (#166)

La transacción compartida exige existencia, ausencia de `deletedAt` y TTL de
foto posterior a la hora muestreada al construirla. El DELETE marca antes de
consultar espejos; la limpieza conserva las claves inversas hasta terminar
los borrados directos por página. Reentregas y ambos triggers se verifican en
`tests/integration/photoDeletionBarrier.test.ts` con DynamoDB/S3 emulados y
Rekognition simulado. No son una aceptación AWS nueva. Detalle y límites en
[evidencia #166](../docs/evidence/issue-166-photo-matching-barrier.md).
