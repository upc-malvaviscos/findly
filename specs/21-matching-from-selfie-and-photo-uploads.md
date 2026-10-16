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
de los tres órdenes de subida (2026-10-14): sandbox desplegado, los tres
recorridos ejecutados contra Rekognition/DynamoDB/SQS reales con
`scripts/deployed-issue-87-acceptance.mjs`, y stack destruido con
colecciones Rekognition borradas explícitamente. Véase la
[evidencia](../docs/evidence/issue-87-matching-convergence.md) para el
detalle, incluido un hallazgo real (el trigger S3 falla su primer intento si
ningún selfie ha sido indexado todavía para el evento; el backfill
converge). **No incluye** evidencia AWS de "sin rostro/bajo umbral/otro
evento", paginación con varias páginas reales ni borrado concurrente
_durante_ el matching — esos tres criterios siguen solo con evidencia
unitaria. El benchmark de coste/capacidad que ADR-022 exige para cerrar #49
tampoco queda satisfecho por este run (aporta una carrera real documentada,
no las medidas de coste que pide el checklist de #49).

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
     página de 25 fotos), ignorando fotos cuyo propio `ttl` ya expiró.
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
      Mocks no presentados como esta evidencia; "sin rostro/bajo umbral/otro
      evento", paginación con varias páginas reales y borrado concurrente
      durante el matching siguen solo con evidencia unitaria.
- [ ] Spec 07, ADR, evidencia e issue #87 sincronizados y cerrados — esta
      entrega sincroniza ADR-022/spec 02/spec 21 y añade evidencia AWS real;
      #87 permanece abierta hasta registrar el resultado en la issue (fase
      Sync) y #49 hasta su benchmark de coste/capacidad propio.
