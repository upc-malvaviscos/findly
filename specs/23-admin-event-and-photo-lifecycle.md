# 23 - Edición y borrado administrativo de eventos y fotografías

<!-- requirement: REQ-ADMIN-EVENT-PHOTO-LIFECYCLE -->
<!-- requirement: REQ-PHOTO-MATCHING-BARRIER -->

Seguimiento: [issue #89](https://github.com/upc-malvaviscos/findly/issues/89).
Continúa spec [04](04-admin-event-management-and-cognito-authorization.md); no
duplica Cognito, creación de eventos ni subida masiva ya implementadas.
Coordina con #10 (derecho al olvido del participante, que esta entrega no
repite), #86 (envíos de galería por email) y #87 (matching tras ambos órdenes
de subida), sin bloquear su propio avance.

## Objetivo

Permitir a un organizador autenticado editar los datos de un evento, listar
sus fotografías de forma paginada, eliminar una fotografía individual y
eliminar un evento completo, limpiando de forma durable todo lo que depende de
él (S3, DynamoDB, colección de Rekognition) sin dejar coincidencias, tokens o
localizadores huérfanos.

## Alineación con AWS Well-Architected Framework

- **Seguridad**: autorización Cognito/JWT en cada ruta nueva, igual que las
  existentes; ningún borrado se oculta sólo en la UI.
- **Fiabilidad**: limpieza idempotente y reanudable; un borrado repetido sobre
  un recurso ya ausente no falla.
- **Optimización de Costes**: reutiliza la limpieza paginada ya escrita para
  `retentionPurger`, sin introducir un segundo mecanismo de borrado.

## Dependencias

Specs 02 (claves DynamoDB), 04 (administración), 07/implícito en matching, 09
(retención y borrado), 20 (envíos de galería, estado `EMAIL#`), 22
(coordinación ya registrada con esta spec). ADR-013 (localizador durable),
ADR-014 (selfies inmutables), ADR-015 (colecciones por entorno), ADR-022
(confirma DynamoDB y fija el contrato de acceso inverso foto→match que esta
spec consume).

La issue #49 está cerrada tras su benchmark AWS y ADR-022 sigue vigente.
Esta spec está implementada y #89 cerrada; el protocolo posterior del tombstone
de #121 frente al matching está implementado localmente en #166, pendiente
de aceptación AWS específica. No se extrapolan
las carreras históricas a todos los estados del código actual.

## Decisiones de diseño (acordadas antes de implementar)

1. **Borrado de evento: Lambda síncrona que reutiliza la limpieza de
   `retentionPurger`.** Se extraen `deleteEventObjects`,
   `deleteEventRecords`, `reconcileErasedLocator`,
   `assertEventCollectionOrigin` y `deleteEventCollection` de
   `src/lambdas/retentionPurger.ts` a un módulo compartido
   `src/lambdas/lib/eventCleanup.ts`, parametrizado por los clientes y nombres
   ya inyectados por cada lambda (no por constantes de módulo). El nuevo
   endpoint `DELETE /admin/events/{eventId}` marca el evento como cerrado de
   forma inmediata (bloquea nuevas inscripciones/subidas) y ejecuta la misma
   limpieza paginada de forma síncrona dentro de la propia petición, devolviendo
   `204` al terminar. No se introduce un mecanismo de progreso/encuesta: a la
   escala real de este proyecto (eventos de demo con pocas fotos) una llamada
   síncrona es suficiente, y reutiliza exactamente el código ya probado del
   cron en vez de duplicar orquestación. Un evento con un volumen de datos muy
   superior al de esta demo podría agotar el timeout de integración de API
   Gateway (~29 s); no es un caso real contemplado aquí y queda documentado
   como límite conocido, no corregido.
2. **Edición de evento: sólo prospectiva.** Editar `name`/`date`/`retentionDays`
   actualiza únicamente el ítem `Event`. `createPhotoUploads` y
   `retentionPurger` ya leen `retentionDays` en vivo para calcular
   `expiresAt`, así que una ampliación o reducción de retención se aplica
   automáticamente a comprobaciones futuras (nuevas subidas, próxima purga)
   sin migrar nada. Los `ttl` ya escritos en `Registration`/`Photo` (fijados en
   el momento de su creación) no se reescriben: ampliar la retención de un
   evento no prolonga en silencio el consentimiento o los tokens ya emitidos
   para inscripciones existentes.
3. **Sin backfill del ítem espejo de ADR-022.** No existe todavía ninguna
   demo persistente con datos reales que backfillear. El borrado de foto
   depende de que el ítem espejo exista (matches escritos después de esta
   entrega lo tienen); se documenta como limitación conocida para cuando
   exista un entorno persistente con datos previos a ADR-022.

## Estado de partida (lo que ya existe)

- `src/lambdas/adminEvents.ts` ya implementa `listAdminEvents`,
  `createAdminEvent` y `createPhotoUploads`, con el mismo patrón de
  `withRequestLog`/Zod/DynamoDB que esta spec reutiliza.
- `src/lambdas/retentionPurger.ts` ya contiene toda la lógica de limpieza por
  evento (objetos S3, registros, coincidencias, tokens, localizador,
  colección) que esta spec extrae a un módulo compartido en vez de
  reescribir.
- `src/lambdas/photoMatcher.ts` ya escribe el ítem espejo
  `PHOTO#{eventId}#{photoId}/MATCH#{registrationId}` en la misma transacción
  que el match (ADR-022, implementado junto con esta spec).
- `infra/modules/admin-api` ya expone el patrón `for_each` sobre un mapa de
  funciones; añadir una ruta nueva es una entrada más en ese mapa.

## Especificación Backend

### `PATCH /admin/events/{eventId}` (editar evento)

- Body: `{ name?: string; date?: string; retentionDays?: number }` (mismas
  validaciones Zod que `createAdminEventSchema`, todos los campos opcionales
  pero al menos uno presente).
- Autorización JWT de Cognito, igual que el resto de `/admin/*`.
- `404 EVENT_NOT_FOUND` si el evento no existe. `200` con el evento actualizado
  si tiene éxito. No reescribe `ttl` de `Registration`/`Photo` existentes
  (decisión de diseño 2).

### `GET /admin/events/{eventId}/photos` (listar fotos, paginado)

- Query opcional `?cursor=` (token de paginación opaco, serialización del
  `LastEvaluatedKey` de DynamoDB).
- `Query` sobre `PK = EVENT#{eventId}, SK begins_with PHOTO#`, igual patrón
  que el resto de consultas por partición ya existentes.
- Respuesta: `{ photos: Array<{ photoId: string; uploadedAt: string }>; nextCursor?: string }`.

### `DELETE /admin/events/{eventId}/photos/{photoId}` (borrar una foto)

- Persiste primero el tombstone `deletedAt` (con `if_not_exists` para conservar
  la primera fecha), elimina `s3Key`, `fileName` y `uploadedAt`, y conserva el
  TTL existente. Esa escritura es la barrera antes de consultar espejos.
- Consulta por páginas y con lectura fuerte `PK = PHOTO#{eventId}#{photoId}`
  (ADR-022), sin Scan. Por página borra primero todos los
  `REG#{registrationId}/MATCH#{photoId}` y sólo después sus espejos
  `PHOTO#{eventId}#{photoId}/MATCH#{registrationId}`, en lotes de 25 con
  reintento de `UnprocessedItems`. Así un fallo parcial no elimina las claves
  necesarias para descubrir coincidencias pendientes en el reintento.
- Borra S3 por la clave determinista y responde `204` tras completar la limpieza.
  Repetir el borrado mantiene fecha, TTL e identificador de operación;
  las nuevas solicitudes de subida reciben `PHOTO_DELETED`.
- `writeMatch` revalida atómicamente existencia, ausencia de `deletedAt` y
  `ttl > :now` en la transacción de match/espejo. `:now` se toma del reloj
  de la Lambda al construir la transacción; no es un reloj servidor DynamoDB.
  Una transacción serializada antes de la barrera queda visible a la consulta
  fuerte; una posterior falla la condición. Ambos triggers comparten esa regla.
- [#166](https://github.com/upc-malvaviscos/findly/issues/166) implementa este protocolo con pruebas unitarias y Floci. La aceptación
  AWS específica y el despliegue siguen pendientes; el benchmark histórico
  de #89 no demuestra esta nueva interacción con tombstones. Véase
  [evidencia #166](../docs/evidence/issue-166-photo-matching-barrier.md).
- No hay transacción conjunta con S3/Rekognition. Una URL PUT emitida antes
  del borrado no se revoca: un PUT tardío puede recrear un objeto S3 hasta la
  limpieza de retención, pero no habilita matches con el tombstone vigente.
  No se promete cobertura tras la eliminación física del marcador por TTL ni
  se cambia la coordinación del borrado de evento completo.

### `DELETE /admin/events/{eventId}` (borrar evento completo)

- Marca el evento (p. ej. `status = 'CLOSED'`, o condición equivalente que ya
  respeten `createPhotoUploads` y la inscripción pública) de forma rápida y
  condicional antes de limpiar, para que ninguna subida/inscripción nueva se
  cuele durante el borrado.
- Ejecuta síncronamente `deleteEventObjects`, `deleteEventRecords` (que ya
  recorre registros, coincidencias, tokens, estado de email vía
  `eraseEmailState`, y marca/reconcilia localizadores) y, si la limpieza queda
  completa, `deleteEventCollection` y el borrado final del ítem `Event` —
  exactamente el mismo camino que ya ejecuta `retentionPurger` para un evento
  expirado, invocado bajo demanda en vez de esperar al cron.
- `204` al terminar. Un localizador bloqueado por la barrera de
  `cleanupAfter` (ADR-013) dejará el evento parcialmente limpio hasta que el
  cron la supere, igual que ya ocurre hoy con la purga automática.

## Especificación Frontend

- **Editar evento**: formulario en `AdminEvents.tsx` (o un componente propio)
  para `name`/`date`/`retentionDays` del evento seleccionado, reutilizando la
  validación del formulario de creación.
- **Listado de fotos**: componente paginado con miniatura o nombre de foto,
  botón «Eliminar» por fila con confirmación explícita antes de enviar el
  `DELETE`.
- **Borrar evento**: acción con confirmación explícita de dos pasos (texto de
  advertencia + botón de confirmación, patrón ya usado por
  `GalleryEmailSender`/`ErasureModal`), estado de progreso mientras la
  petición síncrona está en curso, y mensaje de éxito/error al terminar.

## Guía de Implementación Paso a Paso

1. Extraer la limpieza por evento de `retentionPurger.ts` a
   `src/lambdas/lib/eventCleanup.ts`, parametrizada por clientes y nombres;
   `retentionPurger.ts` pasa a importarla sin cambiar su comportamiento
   (regresión cero, mismas pruebas existentes en verde).
2. Añadir `updateAdminEvent`, `listEventPhotos`, `deleteEventPhoto` y
   `deleteAdminEvent` a `src/lambdas/adminEvents.ts`, con sus DTOs/Zod en
   `shared/types/api.ts`/`shared/lib/validations.ts`.
3. Añadir las cuatro rutas a `infra/modules/admin-api/main.tf` (una entrada
   más en el mapa `local.functions`, con IAM mínimo específico por handler).
4. Frontend: formulario de edición, listado paginado de fotos con borrado por
   fila, y acción de borrado de evento con confirmación y progreso.
5. Pruebas unitarias por handler (aws-sdk-client-mock), prueba de regresión de
   `retentionPurger` tras la extracción, y pruebas de componente para las
   nuevas vistas de administración.
6. Evidencia, ADR de las tres decisiones de diseño si no existe ya, y
   sincronización de specs/issue/checklist.

## Errores Comunes a Evitar (Pitfalls)

- ❌ Borrar sólo el lado `REG#.../MATCH#photoId` de un match y dejar huérfano
  el ítem espejo `PHOTO#.../MATCH#registrationId`, o viceversa.
- ❌ Reescribir el `ttl` de inscripciones/fotos existentes al ampliar la
  retención de un evento ya editado — prolonga en silencio un consentimiento
  ya fijado.
- ❌ Permitir que `createPhotoUploads` o la inscripción pública acepten un
  evento marcado para borrado mientras la limpieza síncrona todavía está en
  curso (condición de carrera entre el marcado y la limpieza).
- ❌ Tratar un `404`/ausencia de recurso durante el borrado como error: debe
  ser idempotente, igual que `deleteRegistration`.
- ❌ Volver a implementar la paginación/limpieza de `retentionPurger` en vez de
  extraerla y reutilizarla.

## Criterios de Aceptación y Verificación

- [x] Creación/listado/subida existentes sin regresiones tras la extracción
      de `eventCleanup.ts` (verificado: unitarias, no AWS).
- [x] Edición de evento validada, reflejada en panel admin y en
      `GET /events` público donde aplique; `ttl` de ítems existentes
      inalterado. _(Reflejo en `GET /events` confirmado contra AWS real en
      PR #146 (2026-10-17); `ttl` de una inscripción y una foto existentes
      confirmado inalterado tras editar `retentionDays` contra AWS real en
      PR #147, 2026-10-17.)_
- [x] Listado paginado de fotos y eliminación de una foto confirmada, con
      limpieza de ambos ítems de match por cada registro afectado.
      _(Eliminación y limpieza de match/espejo confirmadas contra AWS real a
      escala — 100 y 1.000 matches, 2026-10-16; paginación real con 21 fotos
      en dos páginas de cursor confirmada contra AWS real en PR #146,
      2026-10-17. Ver `docs/evidence/issue-89-admin-event-photo-lifecycle.md`.)_
- [x] Foto ausente en S3/metadatos y en la galería de todos los participantes
      afectados tras su borrado. _(Metadatos DynamoDB, objeto S3 y galería del
      participante emparejado confirmados ausentes contra AWS real tras un
      match real, PR #146, 2026-10-17.)_
- [x] Evento borrado: nuevas inscripciones/subidas rechazadas de inmediato;
      objetos S3, registros, coincidencias, tokens y colección limpios al
      terminar la petición síncrona. _(Objetos S3 (selfie y foto), registro,
      match y token confirmados ausentes contra AWS real tras borrar un
      evento con una inscripción `ENROLLED` y una foto emparejada reales,
      PR #146, 2026-10-17. La colección de Rekognition y la fila `Event` se
      difieren al siguiente paso del cron por diseño (ADR-023), sin cambios.
      El rechazo inmediato de nuevas inscripciones/subidas contra un evento
      recién cerrado confirmado contra AWS real en PR #147, 2026-10-17: el
      registro público devuelve `404 EVENT_NOT_FOUND` (`publicEnrollment.ts`
      reserva `410` para un evento `OPEN` pero caducado por retención) y la
      subida de foto administrativa devuelve `410 EVENT_EXPIRED`
      (`createPhotoUploads` usa `410` para ambos casos) — inconsistencia
      preexistente entre ambos endpoints, ajena a esta spec, no corregida
      aquí.)_
- [x] Repetir un borrado (foto o evento) sobre un recurso ya ausente no falla
      (verificado por unitarias: ambos handlers devuelven `204`/sin excepción).
- [x] JWT ausente o insuficiente rechaza las cuatro rutas nuevas. _(Confirmado
      contra AWS real para las cuatro rutas (`PATCH`, `GET photos`,
      `DELETE photo`, `DELETE event`), tanto token ausente como inválido,
      sin efecto alguno sobre el evento/foto reales. PR #146, 2026-10-17.)_
- [x] Unitarias en verde, incluida la regresión de `retentionPurger` tras la
      extracción compartida (690 pruebas lambda+web en total).
- [x] Specs 04/23, ADR, evidencia e issue #89 sincronizados; gates locales en
      verde (`npm run verify`).

## Estado de implementación

Backend, infraestructura Terraform y UI implementados y probados localmente
(unitarias, lint, typecheck, build, `terraform fmt`/`tflint`/`terraform
validate`). Las cuatro rutas, su limpieza síncrona y su rechazo JWT están
además verificados contra AWS real: el timeout/lotes de `deleteEventPhoto` y
la carrera `writeMatch` vs. foto borrada (PR #143/#144, 2026-10-16), y el
resto de criterios restantes — edición reflejada en `GET /events`,
paginación real con cursor, borrado de foto con S3/galería, borrado de
evento con limpieza síncrona completa y rechazo JWT en las cuatro rutas
(PR #146, 2026-10-17), y los dos últimos — `ttl` inalterado tras editar
retención y rechazo inmediato de inscripciones/subidas contra un evento
recién cerrado (PR #147, 2026-10-17). Todos los criterios de esta spec quedan verificados;
el detalle completo está en
[`issue-89-admin-event-photo-lifecycle.md`](../docs/evidence/issue-89-admin-event-photo-lifecycle.md).

- `src/lambdas/lib/eventCleanup.ts` (nuevo): extrae la limpieza por evento de
  `retentionPurger.ts`, sin cambiar su comportamiento (sus 16 pruebas
  existentes pasan sin modificar).
- `src/lambdas/photoMatcher.ts`: escribe el ítem espejo de ADR-022 en la
  misma transacción que el match.
- `src/lambdas/adminEvents.ts`: `updateAdminEvent`, `listEventPhotos`,
  `deleteEventPhoto`, `deleteAdminEvent`.
- `infra/modules/admin-api/main.tf`: cuatro rutas nuevas, IAM mínimo por
  handler (ver ADR-023).
- `src/web/components/admin/AdminEvents.tsx` y
  `EventPhotoManager.tsx` (nuevo): formulario de edición, listado paginado
  de fotos con borrado confirmado, borrado de evento con confirmación en dos
  pasos.
- Decisiones de diseño documentadas en
  [ADR-023](../docs/adr/ADR-023-synchronous-admin-event-deletion.md).
- Evidencia:
  [`issue-89-admin-event-photo-lifecycle.md`](../docs/evidence/issue-89-admin-event-photo-lifecycle.md).
