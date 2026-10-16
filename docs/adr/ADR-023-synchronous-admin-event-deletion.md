# ADR-023: Borrado administrativo síncrono de eventos y fotografías

## Estado

Aceptado (2026-10-14), decisiones de implementación de la issue #89.

## Contexto

La issue #89 (spec 23) añade edición y borrado administrativo de eventos y
fotografías. El borrado de un evento completo implica limpiar S3, DynamoDB y
la colección de Rekognition del mismo modo que ya hace `retentionPurger` para
un evento expirado por retención — la pregunta era cómo ejecutar esa misma
limpieza bajo demanda, no en qué consiste.

## Decisión 1: reutilizar la limpieza de `retentionPurger`, invocada de forma síncrona

Se extraen `deleteEventObjects`, `deleteEventRecords`, `reconcileErasedLocator`,
`reconcileActiveEvent`, `assertEventCollectionOrigin` y `deleteEventCollection`
de `src/lambdas/retentionPurger.ts` a `src/lambdas/lib/eventCleanup.ts`.
`DELETE /admin/events/{eventId}` marca el evento como `CLOSED` de forma rápida
y condicional, y ejecuta la misma limpieza paginada síncronamente dentro de la
propia petición, devolviendo `204` al terminar.

Alternativas consideradas y descartadas:

- **Operación asíncrona con sondeo** (como el envío de galerías por email):
  más fiel a la palabra "progreso" de la issue, pero añade un mecanismo de
  estado/sondeo nuevo para una limpieza que, a la escala real de este
  proyecto (eventos de demo con pocas fotos), ya es rápida de por sí.
- **Marcar para expiración inmediata y esperar al cron diario**: reutiliza el
  100% del código existente sin añadir nada, pero no da ninguna confirmación
  de éxito/fallo al administrador — contradice el criterio de aceptación
  explícito de la issue.

Un evento con un volumen de datos muy superior al de esta demo podría agotar
el timeout de integración de API Gateway (30 s por defecto); no es un caso
real contemplado aquí y queda documentado como límite conocido, no corregido.
El timeout de la Lambda se fija en 60 s precisamente para que, si eso ocurre,
la limpieza termine en segundo plano aunque el cliente ya haya recibido un
error de timeout — un reintento idempotente encontraría mucho menos que
limpiar.

## Decisión 2: la barrera de ADR-013 se ancla en "ahora", no en la expiración de retención

El cron ancla su barrera de `cleanupAfter` (300 s de ventana PUT + 6 h de edad
máxima de evento S3 asíncrono + margen) en la fecha de expiración de
retención del evento, porque sólo actúa sobre eventos ya expirados. Un
borrado administrativo puede ocurrir en cualquier momento de la vida del
evento, mucho antes de su expiración — anclar la misma barrera a la
expiración (en vez de a "ahora") dejaría la colección de Rekognition y el
ítem `Event` sin poder borrarse hasta esa fecha futura, potencialmente
semanas después.

`eventCleanupDeadline(anchorSeconds, cleanupAfter)` se parametriza por el
ancla en vez de derivarla siempre de `retentionDays`/`createdAt`: el cron le
pasa la expiración de retención calculada (comportamiento sin cambios), el
borrado administrativo le pasa `Math.floor(Date.now() / 1000)`. El efecto
práctico: el borrado administrativo limpia inmediatamente S3, DynamoDB,
coincidencias, tokens y localizadores, pero la colección de Rekognition y el
ítem `Event` desnudo sólo se destruyen si esa barrera ya ha pasado — en la
práctica, nunca en la misma petición, sólo en la siguiente pasada del cron,
~6 horas después. Es la misma garantía de seguridad que ya existe hoy para el
cron, alcanzada bajo demanda en vez de sólo por expiración.

## Decisión 3: sin backfill del ítem espejo de ADR-022 para el borrado de fotos

`DELETE /admin/events/{eventId}/photos/{photoId}` usa el ítem espejo
`PHOTO#{eventId}#{photoId}` de ADR-022 para encontrar las inscripciones
afectadas sin Scan. Ningún entorno persistente con datos reales existe
todavía (confirmado: los despliegues actuales son efímeros o de sandbox), así
que no hay nada que backfillear. Se documenta como brecha conocida para
cuando exista un entorno persistente con coincidencias anteriores a ADR-022;
no se construye un trabajo de backfill en esta entrega.

## Consecuencias

- `retentionPurger.ts` pasa a importar la limpieza compartida; sus 16 pruebas
  existentes pasan sin cambios (extracción, no reescritura).
- `deleteAdminEvent` necesita permisos IAM equivalentes a los de
  `retentionPurger` (DynamoDB, S3, Rekognition) más `FINDLY_UPLOADS_BUCKET`/
  `FINDLY_COLLECTION_NAMESPACE` en su entorno Lambda.
- Un evento borrado por un administrador puede seguir teniendo su colección
  de Rekognition y su ítem `Event` desnudo durante hasta ~6 horas después de
  la petición `204`; no es observable por ningún cliente (la galería, el
  listado público y las subidas ya quedan bloqueados de inmediato por
  `status = 'CLOSED'`), pero debe tenerse en cuenta si se audita el estado
  de AWS justo después de un borrado administrativo.
