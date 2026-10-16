# 23 - Edición y borrado administrativo de eventos y fotografías

<!-- requirement: REQ-ADMIN-EVENT-PHOTO-LIFECYCLE -->

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

La issue #49 permanece abierta (benchmark de convergencia pendiente); esta
spec no depende de su cierre, sólo del contrato de acceso que ADR-022 ya fijó.

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

- Borra el objeto S3 de la foto, el ítem `Photo`, y todas las coincidencias
  asociadas en ambas direcciones: consulta
  `PK = PHOTO#{eventId}#{photoId}` (ítem espejo, ADR-022) para encontrar cada
  `REG#{registrationId}` afectado sin Scan, y borra tanto
  `REG#{registrationId}/MATCH#{photoId}` como
  `PHOTO#{eventId}#{photoId}/MATCH#{registrationId}` para cada uno.
- Idempotente: repetir el borrado sobre una foto ya ausente devuelve `204` sin
  fallar (mismo criterio que `deleteRegistration`).
- No reactiva ni recrea nada si un evento S3 tardío llega después: el
  consumidor de `photoMatcher` ya trata una foto sin `Photo` persistido o un
  evento cerrado como no accionable (a verificar/reforzar si hiciera falta).

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
- [ ] Edición de evento validada, reflejada en panel admin y en
      `GET /events` público donde aplique; `ttl` de ítems existentes
      inalterado. _(Lógica unitaria verificada; sin confirmar contra AWS
      real ni el endpoint público desplegado.)_
- [ ] Listado paginado de fotos y eliminación de una foto confirmada, con
      limpieza de ambos ítems de match por cada registro afectado.
      _(Unitaria; sin AWS real.)_
- [ ] Foto ausente en S3/metadatos y en la galería de todos los participantes
      afectados tras su borrado. _(Requiere AWS real o Floci; no ejecutado.)_
- [ ] Evento borrado: nuevas inscripciones/subidas rechazadas de inmediato;
      objetos S3, registros, coincidencias, tokens y colección limpios al
      terminar la petición síncrona. _(Lógica unitaria verificada contra la
      misma limpieza ya acreditada en AWS para `retentionPurger`
      (`docs/evidence/issue-70-erasure-retention.md`); esta entrega en sí no
      repite esa aceptación AWS.)_
- [x] Repetir un borrado (foto o evento) sobre un recurso ya ausente no falla
      (verificado por unitarias: ambos handlers devuelven `204`/sin excepción).
- [ ] JWT ausente o insuficiente rechaza las cuatro rutas nuevas. _(Delegado
      al mismo autorizador JWT de API Gateway que ya protege `/admin/*`; sin
      confirmar contra AWS real para estas rutas específicas.)_
- [x] Unitarias en verde, incluida la regresión de `retentionPurger` tras la
      extracción compartida (307 pruebas lambda+web en total).
- [x] Specs 04/23, ADR, evidencia e issue #89 sincronizados; gates locales en
      verde (`npm run verify`).

## Estado de implementación

Backend, infraestructura Terraform y UI implementados y probados localmente
(unitarias, lint, typecheck, build, `terraform fmt`/`tflint`/`terraform
validate`). Ningún recurso AWS se ha aplicado ni validado en esta entrega;
la aceptación desplegada queda pendiente, igual que el resto de criterios
marcados como tales arriba.

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
