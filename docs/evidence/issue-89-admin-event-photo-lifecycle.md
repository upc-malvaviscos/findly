# Evidencia: edición y borrado administrativo de eventos y fotografías

<!-- requirement: REQ-ADMIN-EVENT-PHOTO-LIFECYCLE -->

Implementación de la spec [23](../../specs/23-admin-event-and-photo-lifecycle.md)
([issue #89](https://github.com/upc-malvaviscos/findly/issues/89)).

**No se ha aplicado ni validado ningún recurso AWS en esta entrega.** Toda la
validación es local: unitarias con `aws-sdk-client-mock`, `terraform
fmt`/`tflint`/`terraform validate` sin desplegar, build y lint.

## Alcance

- `src/shared/lib/dynamoKeys.ts`: `matchMirrorKey`/`photoMatchPartitionKey`
  (ADR-022).
- `src/lambdas/photoMatcher.ts`: `writeMatch` escribe el ítem espejo
  `PHOTO#{eventId}#{photoId}/MATCH#{registrationId}` en la misma transacción
  que el match existente.
- `src/lambdas/lib/eventCleanup.ts` (nuevo): extrae
  `deleteEventObjects`/`deleteEventRecords`/`reconcileErasedLocator`/
  `reconcileActiveEvent`/`assertEventCollectionOrigin`/`deleteEventCollection`/
  `eventCleanupDeadline` de `src/lambdas/retentionPurger.ts`. Extracción pura:
  las 16 pruebas existentes de `retentionPurger` pasan sin modificar.
- `src/lambdas/adminEvents.ts`: cuatro handlers nuevos —
  `updateAdminEvent` (`PATCH /admin/events/{eventId}`),
  `listEventPhotos` (`GET /admin/events/{eventId}/photos`, paginado con
  cursor opaco en `src/lambdas/lib/pagination.ts`),
  `deleteEventPhoto` (`DELETE .../photos/{photoId}`, usa el ítem espejo para
  encontrar cada inscripción afectada sin Scan) y
  `deleteAdminEvent` (`DELETE /admin/events/{eventId}`, marca `CLOSED` y
  ejecuta la limpieza de `eventCleanup.ts` síncronamente; ver ADR-023 para el
  razonamiento completo de las tres decisiones de diseño).
- `infra/modules/admin-api/main.tf`: cuatro rutas nuevas; el mapa de
  funciones pasa de un par `actions`/`resources` a una lista de sentencias
  IAM por función, más variables de entorno adicionales opcionales
  (`delete_event` recibe `FINDLY_UPLOADS_BUCKET`/`FINDLY_COLLECTION_NAMESPACE`,
  iguales a las de `retention-purger`).
- `src/web/adminApi.ts`: `updateAdminEvent`/`getEventPhotos` (JSON, vía
  `apiClient`) y `deleteEventPhoto`/`deleteAdminEvent` (`204`, `fetch` directo
  — `apiClient` siempre llama a `response.json()`, que falla con un cuerpo
  vacío; el mismo motivo por el que `deleteRegistration` en `galleryApi.ts`
  no usa `apiClient`).
- `src/web/components/admin/AdminEvents.tsx`: formulario de edición
  (precargado desde el evento seleccionado mediante el patrón de React
  "ajustar estado cuando cambia una prop" durante el render, no en un efecto,
  para cumplir la regla `react-hooks/set-state-in-effect`), acción "Eliminar
  evento" con confirmación en dos pasos.
- `src/web/components/admin/EventPhotoManager.tsx` (nuevo): listado paginado
  de fotos ("Cargar más fotografías"), borrado por fila con confirmación en
  dos pasos.
- `docs/adr/ADR-023-synchronous-admin-event-deletion.md` (nuevo): las tres
  decisiones de diseño acordadas antes de implementar (borrado síncrono
  reutilizando `eventCleanup.ts`; barrera de ADR-013 anclada en "ahora" en vez
  de en la expiración de retención; sin backfill del ítem espejo de ADR-022
  por ausencia de datos reales que backfillear).

## Hallazgos no relacionados, corregidos por bloquear la tarea

- `src/lambdas/adminEvents.ts` contenía un byte NUL literal (`0x00`) en lugar
  del escape `\u0000` original usado como separador en el hash del
  `eventId`, introducido por accidente en un commit anterior ajeno a esta
  issue. Mismo hash de salida verificado byte a byte; corregido porque
  bloqueaba cualquier herramienta de edición consciente de NUL.
- Los 7 roots de Terraform fallaban `terraform validate` (vía el flujo
  `-lockfile=readonly` que usa `scripts/terraform-validate.mjs`) con un
  checksum no reconocido para `hashicorp/aws` 6.66.0: esta máquina Windows
  nunca había ejecutado `terraform init` sobre el repositorio (sólo CI, en
  Ubuntu, lo había hecho). Se añadió el hash correspondiente
  (`h1:xehZnyesOrJ1/R9tmnRSu7FRkwoDDKelEHI3WdnJ72g=`) a los 7
  `.terraform.lock.hcl` mediante un `terraform init` normal; ninguna otra
  línea cambió.
- `scripts/prepare-email-acceptance.mjs` construía su ruta de escritura con
  `join(parent, destination.split('/').at(-1))`: en Windows `destination` usa
  `\`, `split('/')` nunca encuentra nada y `.at(-1)` devuelve la ruta absoluta
  completa, que `join` vuelve a concatenar sobre `parent` — produciendo una
  ruta anidada sin sentido y `ENOENT`. Corregido con `path.basename()` y
  `path.relative()` (consciente del separador de cada plataforma) en vez de
  una comprobación de prefijo que sólo funcionaba con `/`.
- Dos aserciones de prueba en `tests/infra/` dependían de garantías que NTFS
  no puede dar: bits de permiso POSIX exactos (`0o600`) y creación de enlaces
  simbólicos sin privilegio elevado/Modo de desarrollador. Se hicieron
  condicionales a `process.platform !== 'win32'`, conservando sin cambios la
  parte de cada prueba que sí es multiplataforma (ver commit
  `fix(scripts): resolve the --out path with path.resolve, not path.join`).

## Hallazgo no resuelto: `terraform:test:findly-stack` en Windows

`npm run verify` incluye `terraform:test:findly-stack`
(`scripts/test-findly-stack-infra.mjs`), que ejecuta
`infra/modules/findly-stack/tests/permissions-boundary.tftest.hcl` contra el
módulo compuesto completo (14 submódulos) con `mock_provider "aws" {}`. En
esta máquina, el run `production_without_boundary_rejected` falla con
`Error: No valid credential sources found` / intento real de
`sts:GetCallerIdentity` — Terraform intenta configurar el proveedor real a
pesar del mock declarado.

Diagnóstico, no una suposición:

- **Confirmado ajeno a esta entrega**: reproducido de forma idéntica en un
  worktree limpio de `origin/main`, sin ningún cambio de la issue #89.
- **No cubierto por CI**: `.github/workflows/ci.yml` sólo ejecuta
  `terraform:test:hosting` y `terraform:test:email`, nunca
  `terraform:test:findly-stack` — nadie lo ha validado antes, en ninguna
  plataforma.
- Descartado como causa: variables de entorno de credenciales/región
  ausentes; los `data "aws_caller_identity"`/`data "aws_region"` específicos
  (se probó `override_data` para los 5 módulos que los declaran —
  `admin_api`, `retention_purger`, `delete_registration`, `photo_matching`,
  `selfie_indexer` — sin cambio alguno en el error); paralelismo del plan
  (`-parallelism=1`, sin cambio).
- Hipótesis más probable, sin confirmar: una limitación de `mock_provider` de
  Terraform 1.15.5 específica de composiciones de módulos grandes y muy
  anidadas (los otros dos conjuntos de pruebas Terraform, sobre módulos
  independientes más pequeños, sí pasan con el mismo patrón de mock).

No se ha corregido. Por indicación expresa de la persona responsable, el
`push` de esta rama se hizo con `--no-verify` exclusivamente por este
hallazgo, tras confirmar en verde manualmente cada uno de los demás pasos de
`npm run verify` por separado (ver más abajo). Queda como seguimiento para
quien mantenga el arnés de pruebas Terraform, no como parte del alcance de
esta issue.

## Hallazgo real de #89: las cuatro Lambdas nuevas sin evidencia de log en la aceptación AWS

El primer run real de `provision-test-destroy` (PR #120) sí es de esta
entrega y falló por una causa propia, no ajena: `deployed-observability.mjs`
exige que cada Lambda desplegada (descubierta vía la salida de Terraform
`lambda_function_names`) tenga al menos una línea de log de aplicación antes
de aceptar el run. Las cuatro Lambdas nuevas de administración
(`admin-update_event`, `admin-list_photos`, `admin-delete_photo`,
`admin-delete_event`) nunca se invocaban en
`scripts/deployed-issue-70-acceptance.mjs`, así que fallaba con
`4 !== 0 ... invoke every handler before the probe`.

Corregido añadiendo las cuatro llamadas al recorrido existente, justo después
de la comprobación de entrega duplicada (el evento/foto/match principal ya
está verificado en ese punto; nada posterior depende de lo que se añade) y
antes del borrado por derecho al olvido:

- `PATCH` del nombre del evento principal (inofensivo: nada posterior lee el
  nombre, sólo `eventId`).
- `GET` de su listado de fotos, comprobando que la foto ya emparejada
  aparece.
- Una **segunda** fotografía desechable, subida y borrada por el nuevo
  endpoint — no `upload.photoId`, del que la entrega duplicada y el borrado
  posteriores siguen dependiendo.
- Un **segundo** evento desechable, creado y borrado inmediatamente,
  comprobando que queda `CLOSED` (no que su fila desaparece) — coherente con
  ADR-023: la colección de Rekognition y la fila del evento se difieren a la
  siguiente purga programada, no se borran en la misma petición.

Se canceló el run en curso de un push anterior en cuanto se confirmó esta
causa, porque iba a fallar por el mismo motivo ~20 minutos después.

## Validación

```text
npm run lint                PASS
npm run typecheck           PASS
npm run build                PASS (web + 11 artefactos Lambda .js/.zip)
npm run test                  627 pruebas (lambdas + web + infra), todas en
                              verde (incluye las 2 condicionales a no-Windows
                              arriba, que sí corren y pasan en CI/Ubuntu)
npm run terraform:format    PASS
npm run lint:terraform      PASS (tflint, los 3 roots con módulos)
npm run terraform:validate  PASS (7/7 roots)
npm run terraform:test:hosting PASS
npm run terraform:test:email   PASS
npm run terraform:test:findly-stack  FAIL (ver hallazgo no resuelto arriba;
                              confirmado ajeno a esta entrega)
npm run security             PASS
npm run sync:check           PASS
```

Cada paso se ejecutó también por separado, no sólo dentro de `npm run
verify`, para aislar el fallo exclusivamente al último. No se ejecuta
`npm run test:e2e`, `npm run test:floci:integration` ni `npm run test:aws`:
esta entrega no modifica un flujo E2E existente y no se ha desplegado ningún
entorno AWS/Floci para validarla.

## Corrección posterior: timeout y borrado por lotes en `deleteEventPhoto` (2026-10-16)

El benchmark de #49 (PR #141, comentario del 2026-10-16 en la issue #89)
sembró 100 y 1.000 pares match+ítem-espejo para una sola foto y llamó al
`DELETE /admin/events/{eventId}/photos/{photoId}` real contra el sandbox AWS:
ambos casos devolvieron `500` por timeout, confirmados por log de CloudWatch
y por consulta posterior que mostró ítems espejo huérfanos y la fila de la
foto sobreviviendo al borrado.

Causa doble, corregida aquí:

- `infra/modules/admin-api/main.tf` daba a `delete_photo` un timeout de 3 s
  frente a los 60 s de `delete_event`, insuficiente para las ~200 escrituras
  de borrado que ya exige un solo centenar de matches.
- `deleteEventPhoto` (`src/lambdas/adminEvents.ts`) borraba cada match y su
  ítem espejo con dos `DeleteCommand` individuales por inscripción dentro de
  un `Promise.all`, en vez de agruparlos.

Corrección: `delete_photo` pasa a 60 s (igual que `delete_event`); el nuevo
`batchDeleteItems` agrupa las claves de match+espejo en lotes de 25 con
`BatchWriteCommand`, reintentando `UnprocessedItems` hasta vaciarlos, y el
statement IAM `FindAndDeleteMatchesAndPhoto` añade `dynamodb:BatchWriteItem`.
Tests nuevos en `tests/lambdas/adminEvents.test.ts` cubren 120 inscripciones
(10 llamadas `BatchWriteItem` de hasta 25 ítems cada una, frente a las 240
llamadas `DeleteItem` individuales de antes) y el reintento de un ítem
`UnprocessedItems`. Fusionado a `main` vía PR #143.

### Aceptación AWS real del timeout/lotes (sandbox `912415493378`, 2026-10-16)

Se aplicó el stack completo del sandbox (`infra/environments/sandbox`, 87
recursos, sin RDS, EC2, NAT ni VPC) con los artefactos Lambda reconstruidos
a partir de esta corrección, y se reutilizó (copiándolo, sin fusionar en su
momento) el script de benchmark de la PR #141
(`scripts/deployed-issue-49-fanout-benchmark.mjs`, ya en `main` tras su
fusión) para repetir exactamente el escenario que encontró el `500`:

- **Escenario A (100 matches)**: `DELETE /admin/events/{eventId}/photos/{photoId}`
  devolvió `204` en 2.019 ms. 100 ítems espejo antes, 0 después; 0 de la
  muestra de claves de match sobrevive; la fila de la foto no sobrevive.
- **Escenario A (1.000 matches)**: `204` en 2.732 ms. 1.000 ítems espejo
  antes, 0 después; misma limpieza completa.

El timeout de 60 s y `BatchWriteCommand` **resuelven el `500` observado por
el benchmark de #49** a ambas escalas, con margen amplio (2-3 s de 60
disponibles). Entorno destruido al terminar (145 recursos); comprobación
independiente del estado remoto: serial 68, 0 instancias gestionadas.

**Hallazgo nuevo en ese mismo run, resuelto por una corrección separada**: el
escenario B del script (una foto real subida mientras se borra, con un
`matchPhoto` real en curso por Rekognition) confirmó una carrera que antes
solo estaba señalada como riesgo de diseño sin verificar: el borrado
devolvió `204` y la fila de la foto no sobrevive, pero **el match y su
ítem espejo sí sobrevivían** — `writeMatch` (`src/lambdas/lib/matching.ts`)
no comprobaba que la foto siguiera existiendo antes de escribir un match
tardío. Esta corrección (timeout + lotes) no la resolvía por ser un problema
distinto: una carrera de escritura, no de volumen/timeout. Corregida a
continuación.

## Corrección de la carrera `writeMatch` vs. borrado/expiración de foto (2026-10-16)

Corrección: se añadió un cuarto `ConditionCheck` a la `TransactWriteCommand`
de `writeMatch`, sobre `photoKey(eventId, photoId)` con
`attribute_exists(PK)`. Un fallo de esta condición cae en el mismo camino de
descarte silencioso que ya existía para una inscripción no elegible
(`TransactionCanceledException`/`ConditionalCheckFailed`), así que no añade
lógica de error nueva. Cubre tanto el borrado explícito (#89) como la
expiración natural por `ttl` de la foto. Detalle de diseño y alternativas
descartadas en la nueva adenda de
[ADR-022](../adr/ADR-022-confirm-dynamodb-persistence.md#adenda-2026-10-16-writematch-condiciona-la-escritura-a-que-la-foto-exista).

Validación local: pruebas nuevas/actualizadas en
`tests/lambdas/photoMatcher.test.ts` y
`tests/lambdas/registrationBackfillMatching.test.ts`, `npm run verify`
completo en verde.

### Aceptación AWS real de la carrera `writeMatch` (sandbox `912415493378`, 2026-10-16)

Con esta corrección aplicada (pero sin la de timeout/lotes, en una rama
derivada de `main` independiente de la PR #143 todavía sin fusionar), se
repitió el escenario B: `DELETE` devolvió `204` y **ni el match ni su ítem
espejo sobrevivieron** (antes sí). El mismo run reprodujo el `500` del
escenario A — esperado, por la ausencia del fix de timeout/lotes en esa
rama, no una regresión de esta corrección. Entorno destruido al terminar
(145 recursos); comprobación independiente del estado remoto: serial 83,
0 instancias gestionadas.

### Aceptación AWS real combinada (ambas correcciones, sandbox `912415493378`)

Con la PR #143 ya fusionada a `main`, se repitió el ciclo
apply→benchmark→destroy una vez más desde una rama que ya incluye ambas
correcciones, para confirmar que el escenario A también queda resuelto
junto con el B en el mismo despliegue:

- **Escenario A (100 matches)**: `204` en 2.020 ms, 0 huérfanos.
- **Escenario A (1.000 matches)**: `204` en 3.082 ms, 0 huérfanos.
- **Escenario B (carrera subida/borrado)**: `204`; ni el match ni su ítem
  espejo sobreviven.

Las tres aristas del benchmark de #49 pasan en el mismo despliegue, sin
fallos (`"failures": []`). Entorno destruido al terminar (145 recursos);
comprobación independiente del estado remoto: serial 99, 0 instancias
gestionadas. Sin despliegue permanente.

## Pendiente

- Aceptación desplegada en AWS (o Floci) de las cuatro rutas nuevas en su
  conjunto (edición de evento, listado de fotos, JWT/autorización
  específica de las cuatro rutas): esta sesión solo repitió escenarios del
  benchmark de #49, no el resto de criterios `[ ]` de la spec 23.
- Backfill del ítem espejo de ADR-022 para datos anteriores a su
  introducción: diferido, documentado en ADR-023, sin entorno persistente
  real que lo necesite todavía.
- Coordinación de carreras con #86 (envíos de galería en curso) y #87
  (backfill de matching tras ENROLLED) durante un borrado de evento: la
  limpieza reutilizada de `retentionPurger` ya gestiona `EMAIL#`/`TOKEN#` vía
  `eraseEmailState` y el locator de retención: no se ha añadido una prueba
  dedicada a la carrera específica con el backfill de #87, cuyo propio
  trabajo todavía está en una rama sin fusionar.
