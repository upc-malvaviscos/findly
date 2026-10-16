# Evidencia #87: matching convergente tras subir selfies o fotos

<!-- requirement: REQ-MATCHING-BOTH-ORDERS -->

## Resultado de la ejecución AWS efímera (2026-10-14)

Sandbox desplegado con `infra/environments/sandbox` (backend
`findly-tfstate-912415493378`, usuario `findly_test` con
`AdministratorAccess` temporal para el apply) y destruido al terminar.
`scripts/deployed-issue-87-acceptance.mjs` (nuevo) ejecutó los tres
recorridos de la issue contra Rekognition/DynamoDB/SQS reales, sin mocks:

- **Selfie antes de foto**: `ENROLLED` a los 10.2 s; match a similitud
  100 % por el trigger S3 existente (spec 07), sin regresión.
- **Foto antes de selfie**: foto subida primero; 5 s después, selfie
  inscrita; `ENROLLED` a los 5.8 s; match a similitud 100 % **sin volver a
  subir la fotografía** — el backfill de esta spec lo produjo.
- **Subidas simultáneas**: selfie y foto lanzadas en paralelo
  (`Promise.all`); match a similitud 100 %; comprobado 10 s después que
  sigue existiendo **exactamente un** `Match` (`Query` sobre
  `REG#{registrationId}` con `begins_with(SK, 'MATCH#')`) — convergencia sin
  intervención administrativa y sin duplicar.

Salida completa en
[`docs/evidence/issue-87-acceptance-run.json`](issue-87-acceptance-run.json)
(items reales de DynamoDB por escenario). Tras el run: `terraform destroy`
(117 recursos destruidos, estado remoto vacío) y borrado explícito de las 5
colecciones Rekognition creadas por los handlers (no gestionadas por
Terraform), verificado con `aws rekognition list-collections` vacío.

### Hallazgo real: el primer intento del trigger S3 falla si no hay ninguna selfie inscrita todavía

En los escenarios "foto antes de selfie" y "simultáneo", el trigger S3
normal (`photoMatcher.ts`) procesó la foto **antes** de que existiera
cualquier inscripción `ENROLLED` para ese evento. Log real
(`/aws/lambda/findly-sandbox-photo-matcher`):

```json
{
  "level": "ERROR",
  "event": "photo_matching_failed",
  "correlationId": "cdf9ceca-a70a-4cc9-9da9-64ad190b83c8",
  "eventId": "evt-2738843b780ff0540e28f586",
  "photoId": "488cf94c-6c75-4aee-9d98-0a81acd74eb3",
  "errorName": "ResourceNotFoundException",
  "step": "index_faces"
}
```

Causa: solo `selfieIndexer.ts` crea la colección Rekognition del evento
(`CreateCollectionCommand`, perezoso, en la primera selfie); `matchPhoto` no
la crea. Una foto subida a un evento sin ninguna inscripción `ENROLLED`
previa falla con `ResourceNotFoundException` en `IndexFaces` — mensaje que
vuelve a SQS para reintento (`ReportBatchItemFailures`, `maxReceiveCount = 3`
de spec 07). El backfill, ejecutado después de `ENROLLED` (cuando la
colección ya existe), sí matchea con éxito:

```json
{
  "level": "INFO",
  "event": "registration_backfill_processed",
  "correlationId": "453a358d-1655-4cb2-b789-30af6f3775ba",
  "eventId": "evt-2738843b780ff0540e28f586",
  "photoCount": 1
}
```

No es un defecto: la condición idempotente `attribute_not_exists(PK)` de
`writeMatch` sigue siendo la única garantía de convergencia, y aquí queda
demostrada con una carrera real, no solo en el diseño. Ningún log de
`registration-backfill` ni `photo-matcher` menciona `registrationId`,
confirmado leyendo las líneas reales (solo `eventId`, `photoId`,
`photoCount`, `correlationId`).

### Integración con el borrado de fotos de #89

La integración de #87 y #89 conserva el ítem espejo de ADR-022 en el módulo
compartido `src/lambdas/lib/matching.ts`. Tanto el trigger S3 como el backfill
escriben `REG#{registrationId}/MATCH#{photoId}` y
`PHOTO#{eventId}#{photoId}/MATCH#{registrationId}` en la misma transacción,
con la condición de inscripción vigente y sin duplicar el match.

`tests/lambdas/photoMatcher.test.ts` comprueba el trigger de fotos y
`tests/lambdas/registrationBackfillMatching.test.ts` recorre el backfill con
el módulo real de matching y clientes AWS simulados. Estas pruebas verifican
la integración local; la evidencia AWS del 14 de octubre anterior no
acredita por sí sola el nuevo ítem espejo.

## Alcance

Issue [#87](https://github.com/upc-malvaviscos/findly/issues/87), formalizada en
[specs/21-matching-from-selfie-and-photo-uploads.md](../../specs/21-matching-from-selfie-and-photo-uploads.md)
(sin spec previa: el fichero no existía en el repositorio pese a que la issue
lo referenciaba; se crea en esta entrega). Implementa el contrato de acceso
fijado en [ADR-022](../adr/ADR-022-confirm-dynamodb-persistence.md).

Cambios:

- `src/lambdas/lib/matching.ts` (nuevo): extrae `matchPhoto`, `writeMatch` y
  `findRegistrationForFace` de `photoMatcher.ts`, sin cambiar su
  comportamiento, para que un segundo trigger pueda reutilizar el mismo
  núcleo.
- `src/lambdas/photoMatcher.ts`: sin cambios de comportamiento; pasa a
  importar el núcleo compartido.
- `src/lambdas/registrationBackfill.ts` (nuevo): consume una cola SQS
  (`FINDLY_BACKFILL_QUEUE_URL`), revalida la inscripción disparadora, pagina
  las fotos existentes del evento (`Query`, sin `Scan`) y llama `matchPhoto`
  por cada una; reencola la continuación si quedan páginas.
- `src/lambdas/selfieIndexer.ts`: tras persistir `ENROLLED`+`faceId`, encola
  `{ eventId, registrationId }` en la cola de backfill (best-effort: un
  fallo al encolar no revierte la inscripción ni se reintenta).
- `infra/modules/registration-backfill/` (nuevo): cola + DLQ + alarma +
  Lambda + IAM de mínimo privilegio, mismo patrón que `photo-matching`.
- `infra/modules/selfie-indexer/main.tf`: variables opcionales
  `backfill_queue_arn`/`backfill_queue_url` (default `null`) y el permiso
  `sqs:SendMessage` acotado a esa cola.
- `infra/modules/findly-stack/main.tf`, `infra/ephemeral/main.tf`: wiring del
  módulo nuevo.
- `specs/02-domain-model-api-contracts-and-dynamodb-keys.md`,
  `docs/traceability.json`: ya sincronizados en el PR de ADR-022; sin cambios
  adicionales aquí salvo el nuevo requisito `REQ-MATCHING-BOTH-ORDERS`.

## Validación local

```sh
npm run lint        # PASS
npx tsc --noEmit -p tsconfig.lambda.json   # PASS
npm run verify       # PASS — lint, typecheck, test (626 pruebas), build,
                      # terraform:format/validate/test:*, security, sync:check
```

Pruebas nuevas/reescritas relevantes:

- `tests/lambdas/registrationBackfill.test.ts` (12 pruebas, nuevo):
  - Matchea cada foto ya subida de un evento tras una inscripción recién
    `ENROLLED`.
  - Reencola la continuación con el cursor de DynamoDB cuando quedan más
    páginas.
  - No hace ningún trabajo cuando la inscripción disparadora ya no es
    elegible: `FAILED`, sin `faceId`, `erasureRequestedAt` presente, `ttl`
    expirado o inscripción borrada — cuatro casos parametrizados.
  - Ignora una foto cuyo propio `ttl` ya expiró sin matchearla.
  - Reporta el `itemIdentifier` como fallo de lote sin perder el resto de
    registros cuando `matchPhoto` lanza una excepción.
  - Descarta un mensaje malformado sin reintentarlo indefinidamente.
  - Falla el registro (no se queda bloqueado en silencio) si
    `FINDLY_BACKFILL_QUEUE_URL` falta cuando hace falta continuar.
  - Nunca registra `registrationId` en los logs estructurados; solo
    `eventId` y un contador de fotos.
- `tests/lambdas/photoMatcher.test.ts` (21 pruebas, sin cambios): siguen en
  verde tras extraer el núcleo a `lib/matching.ts`, confirmando que la
  extracción no alteró su contrato.
- `tests/lambdas/selfieIndexer.test.ts` (sin cambios, verificado en verde).
- `tests/infra/collectionIsolation.test.ts`: `registration-backfill` añadido
  a la lista de módulos verificados por namespace de colección Rekognition.
- `scripts/test-findly-stack-infra.mjs` (Terraform tests): el módulo nuevo se
  inicializa y valida junto al resto del stack sin romper las pruebas
  existentes de permissions-boundary.

## Resultado de la ejecución AWS efímera de los tres criterios restantes (2026-10-16)

Mismo sandbox (`infra/environments/sandbox`, cuenta `912415493378`), mismo
script extendido con los escenarios D, E y F. Salida completa en
[`docs/evidence/issue-87-acceptance-run.json`](issue-87-acceptance-run.json).

- **D — sin rostro / bajo umbral / otro evento**: una inscripción `ENROLLED`
  recibió tres fotos, ninguna produjo match:
  - D1 _sin rostro_: PNG sólido sin caras (generado en memoria, válido para
    Rekognition pero sin ningún rostro detectable). Cero `FaceRecords`, cero
    match.
  - D2 _bajo umbral_: `e2e/fixtures/synthetic-adult-face-2.jpg`, una segunda
    persona ficticia distinta de la primera. Cero match — confirma que
    Rekognition las trata como personas distintas por debajo del 95 % de
    similitud exigido.
  - D3 _otro evento_: la misma cara registrada en el evento original se subió
    como foto en un segundo evento. La primera ejecución de este escenario
    dejó esa segunda colección sin crear (ningún selfie inscrito ahí),
    `IndexFaces` falló con `ResourceNotFoundException` y el `null` resultante
    no acreditaba aislamiento real, solo una colección ausente. Se corrigió
    inscribiendo primero una segunda persona (la misma fixture de D2) en el
    segundo evento, para que su colección existiera de verdad; con la
    colección poblada por una persona distinta, la cara original sigue sin
    matchear (`collectionSeededWithDifferentPerson: true`, `match: null`),
    acreditando aislamiento real por colección (ADR-015).
- **E — paginación con varias páginas reales**: 26 fotos subidas a un evento
  (`PHOTO_PAGE_SIZE` es 25) antes de inscribir la selfie. El backfill generó
  **dos invocaciones reales** confirmadas por log
  (`/aws/lambda/findly-sandbox-registration-backfill`):

  ```json
  {"event":"registration_backfill_processed","eventId":"evt-69444376da8b61317abae9c8","photoCount":25}
  {"event":"registration_backfill_processed","eventId":"evt-69444376da8b61317abae9c8","photoCount":1}
  ```

  26 matches persistidos, confirmando que `ExclusiveStartKey`/
  `LastEvaluatedKey` reencola la continuación real, no solo en el diseño.

- **F — revocación/caducidad/borrado concurrente**:
  - F1 _borrado concurrente_: `DELETE` de la inscripción lanzado en paralelo
    (`Promise.all`) con la subida de la foto que la matchearía. 15 s después
    de que ambas promesas resuelven, cero matches (`matchCountAfterErasure:
0`) — la condición `attribute_not_exists(erasureRequestedAt)` de
    `writeMatch` bloquea la escritura si la erasure gana la carrera, y el
    propio `DELETE` borra cualquier match que haya ganado la carrera
    (`deleteRegistration.ts`, borrado síncrono de `MATCH#*` antes de
    devolver `204`).
  - F2 _caducidad_: `ttl` de una inscripción `ENROLLED` adelantado
    manualmente a una hora en el pasado (simula caducidad sin esperar al TTL
    nativo de DynamoDB); una foto subida después no matchea
    (`findRegistrationForFace` descarta inscripciones con `ttl` vencido).

### Hallazgo de la propia prueba: retraso de ingesta de CloudWatch Logs

La primera ejecución de esta ronda falló el escenario E con "backfill did
not show more than one page/invocation" pese a que los 26 matches ya
existían: `FilterLogEventsCommand` se consultó una sola vez justo cuando el
segundo match se escribió, antes de que CloudWatch terminara de indexar esa
línea de log (confirmado reconsultando minutos después: las dos líneas
existían). No es un defecto de `registrationBackfill.ts` — es un fallo de
temporización de la propia prueba, corregido reintentando esa consulta hasta
20 s en vez de leerla una sola vez.

### Teardown de esta ronda

Dos ejecuciones adicionales del script (una fallida por el hallazgo anterior,
una exitosa) crearon 20 colecciones Rekognition en total a lo largo de la
sesión. `terraform destroy` no las gestiona; se borraron explícitamente una
a una con `aws rekognition delete-collection`, confirmado con
`aws rekognition list-collections` vacío antes del `terraform destroy` del
stack (145 recursos destruidos, estado remoto vacío).

## Pendiente — no demostrado todavía

- El benchmark sintético de fan-out/convergencia que
  [ADR-022](../adr/ADR-022-confirm-dynamodb-persistence.md) exige para cerrar
  la issue #49 pide medir coste/latencia bajo ese fan-out; el escenario
  "subidas simultáneas" de este run aporta una carrera real documentada
  (ver más arriba) pero no las medidas de coste/capacidad que el checklist
  de #49 pide todavía — no se presenta aquí como ese benchmark completo. Es
  un entregable propio de #49, independiente de esta spec.
- El ítem espejo de ADR-022 para #89 (ver corrección arriba) sigue sin
  implementar.

## Checklist de aceptación de #87 — estado final

| Criterio                                                                   | Estado                                                                                                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Selfie antes de foto produce match y galería                               | **AWS real**: match 100 % (`docs/evidence/issue-87-acceptance-run.json`, escenario A)                                                       |
| Foto antes de selfie produce match sin resubir fotografía                  | **AWS real**: backfill matcheó sin re-subir (escenario B)                                                                                   |
| Subidas simultáneas convergen sin intervención administrativa              | **AWS real**: un único `Match` tras la carrera (escenario C)                                                                                |
| Duplicados/reintentos no multiplican matches/trabajo innecesario           | **AWS real**: la carrera de C y el reintento SQS de B no duplicaron el match                                                                |
| Sin rostro, bajo umbral y otro evento no generan coincidencias incorrectas | **AWS real (2026-10-16)**: tres fotos, cero matches; "otro evento" con colección poblada por una persona distinta (D)                       |
| Paginación y límites probados con varias páginas de datos                  | **AWS real (2026-10-16)**: 26 fotos, 26 matches, dos invocaciones confirmadas por log (E)                                                   |
| Revocación/caducidad/borrado concurrente no resucita matches               | **AWS real (2026-10-16)**: borrado concurrente con la subida y `ttl` expirado, cero matches en ambos casos (F)                              |
| Unitarias/contrato y AWS efímero sintético con teardown                    | **Completo**: 626 unitarias + dos rondas de run AWS real (262 recursos destruidos en total, colecciones Rekognition borradas, estado vacío) |
| Spec 07, ADR, evidencia e issue sincronizados; gates en verde              | Spec 21 y esta evidencia actualizadas; `npm run verify` en verde; comentario de sincronización añadido a la issue #87                       |

## Revisión de permisos CI del 2026-10-16

La ejecución efímera [38857895356](https://github.com/upc-malvaviscos/findly/actions/runs/38857895356) falló al crear la alarma DLQ del backfill y su conexión Lambda–SQS por permisos IAM insuficientes. El paso de destrucción terminó correctamente. No acredita aceptación del último commit.

La corrección revisable amplía tres declaraciones de `infra/iam/ephemeral-pr-extensions.json` únicamente a la alarma `findly-pr-*-backfill-dlq-has-messages` y la función `findly-pr-*-registration-backfill`, conservando cuenta, región, acciones y condiciones de etiquetas. El mapping declara `tags = local.tags`; los tags efímeros proceden también del proveedor del root de PR. `tests/infra/backfillCiPermissions.test.ts` verifica este contrato estático, no IAM real.

El 2026-10-16, con autorización operativa explícita, se comparó la política vigente v1: solo diferían las tres declaraciones descritas, sin altas ni bajas de acciones. Access Analyzer devolvió cero hallazgos. Siete simulaciones de la política propuesta confirmaron creación, ciclo de vida y alarma del backfill efímero permitidos, y producción y creación sin etiquetas denegadas. Para creación se simuló Resource `*`, como declara la política; un ARN de mapping todavía inexistente no representa esa operación. La simulación no sustituye una petición real.

Se publicó y verificó v2 como versión por defecto de `findly-ephemeral-pr-extensions`, con documento idéntico al revisado y asociación al rol `findly-github-ephemeral-pr-ci`. v1 permanece conservada para recuperación. El resumen de simulación está en [`issue-87-ci-policy-simulation.json`](issue-87-ci-policy-simulation.json). La nueva ejecución completa de CI/AWS sigue pendiente; esta corrección no declara cerrado #87 ni #49.
