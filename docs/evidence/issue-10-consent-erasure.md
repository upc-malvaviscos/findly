# Evidencia de consentimiento, retención y derecho al olvido

Implementación de la spec 09 (issue #10): purga automatizada de datos
caducados y derecho al olvido bajo demanda del asistente, extremo a
extremo (backend + frontend).

## Alcance verificado

- **Corrección de contrato previa (necesaria para poder construir el
  flujo):** `GalleryResponse` (spec 02 §3) no incluía `registrationId`,
  por lo que el cliente no tenía forma de construir
  `DELETE /registrations/{registrationId}` a partir de lo que ya conocía
  (solo el token opaco). Se añade `registrationId` a la respuesta
  (`src/web/types.ts`, `src/lambdas/gallery.ts` y sus tests), documentado
  en `specs/02-...md`. No es PII: es un identificador opaco generado, de
  la misma clase que el resto del contrato.
- `src/lambdas/deleteRegistration.ts`: handler de
  `DELETE /registrations/{registrationId}` con cabecera `X-Gallery-Token`.
  Verifica el hash SHA-256 del token contra el `registrationId` solicitado
  (404 genérico ante cualquier discrepancia, sin filtrar cuál fue el
  motivo — mismo patrón que `gallery.ts`). Borra en este orden: rostro en
  Rekognition (`DeleteFacesCommand`) → selfie en S3 → todos los `MATCH#*`
  de esa inscripción → `REG#*` → `TOKEN#*` (el último, para permitir
  reintentos legítimos del propio dueño del token si algún paso previo
  falla). Los borrados de recursos ya ausentes (`ResourceNotFoundException`,
  `NoSuchKey`) se tratan como éxito idempotente, no como error. Registro de
  auditoría sin PII: solo `eventId`, `registrationId` y contadores — nunca
  el token ni datos biométricos.
- `src/lambdas/retentionPurger.ts`: handler disparado por EventBridge
  Scheduler. Escanea (`Scan`, paginado) los registros `Event` cuya
  `createdAt + retentionDays` ya venció, y para cada uno: purga la
  colección Rekognition (`DeleteCollectionCommand`, idempotente) y borra
  explícitamente el prefijo S3 `events/{eventId}/` (listado + borrado por
  lotes de hasta 1000 claves, paginado). Los registros de DynamoDB
  (`Registration`/`Photo`/`Match`/`GalleryToken`) ya expiran de forma
  nativa vía el atributo `ttl` existente — esta Lambda no los toca.
- `src/lambdas/lib/awsErrors.ts`: helper `isMissingResourceError`
  compartido entre `deleteRegistration.ts` y `retentionPurger.ts`, en vez
  de duplicar la misma comprobación de nombres de excepción en ambos
  ficheros.
- Frontend: `ErasureModal.tsx` (mismo patrón accesible que
  `CameraModal.tsx`: `Escape` para cerrar, restauración de foco), con
  aviso explícito antes de confirmar. `galleryApi.ts` añade
  `deleteRegistration(token, registrationId)`, mismo patrón mock/real que
  el resto del cliente. Integrado en `GalleryPage.tsx` (visible tanto con
  fotos como en el estado "aún no hay fotos", ya que un asistente
  registrado sin coincidencias todavía sigue teniendo derecho al olvido) y
  un nuevo estado `ERASED` con confirmación tras el borrado.
- `infra/modules/retention-purger/`: `aws_scheduler_schedule` (EventBridge
  Scheduler, no el `aws_cloudwatch_event_rule` clásico) con la expresión
  cron de la spec, rol IAM propio para que el Scheduler invoque la Lambda
  (distinto del rol de ejecución de la propia Lambda), rol de ejecución de
  mínimo privilegio (`dynamodb:Scan` limitado a la tabla,
  `rekognition:DeleteCollection` limitado a `collection/findly-event-*`,
  `s3:ListBucket`/`s3:DeleteObject` limitados al prefijo `events/*` del
  bucket de subidas). Memoria/timeout (512 MB/300 s) son valores propios
  razonables: la spec no fija ninguno para esta Lambda, a diferencia de
  `SelfieIndexer`/`PhotoMatcher`. Deliberadamente no conectado a una raíz
  Terraform real (mismo motivo que las issues #6/#8: `infra/main.tf` no
  tiene `provider "aws"` — issue #11).

## Decisión deliberada: sin Terraform para `deleteRegistration`

A diferencia de `retentionPurger.ts` (disparado por EventBridge, necesita
su propia infraestructura de todos modos), `deleteRegistration.ts` es una
Lambda HTTP — y `gallery.ts`, la única otra Lambda HTTP del proyecto
(issue #9), tampoco tiene ningún recurso Terraform todavía. No existe aún
ningún API Gateway en el repositorio. Se sigue ese mismo precedente:
código + tests ahora, enrutado HTTP real cuando exista la infraestructura
de API Gateway (issues #11/#14).

## Pendiente

- Verificación end-to-end contra un entorno real: la galería tras un
  borrado devuelve 404 (comportamiento verificado por inspección de código
  — ambos handlers comparten la misma comprobación de
  `GetCommand`-sin-resultado — pero no probado contra DynamoDB real).
  Pendiente de un entorno desplegado (issue #11).
- El módulo `retention-purger` no está desplegado; la ejecución real del
  cron diario y la purga efectiva quedan pendientes de esa misma issue.
- No se abre ADR nuevo: la corrección de `GalleryResponse` completa un
  contrato ya definido en la spec 02 (no una decisión arquitectónica de
  alto nivel), y el resto es implementación directa de la spec 09.

## Validación

```text
npm run typecheck            PASS
npm run lint:code             PASS
npm run lint:markdown         PASS
npm run test                  PASS (79 tests, 17 archivos; 20 nuevos entre
                               deleteRegistration.test.ts (7),
                               retentionPurger.test.ts (6) y las
                               ampliaciones de gallery.test.tsx (3) y
                               gallery.test.ts (lambda, actualizado))
npm run build                  PASS (web + 4 artefactos Lambda; awsErrors.ts
                               correctamente excluido como librería, igual
                               que presignedUpload.ts)
terraform validate (módulo)    PASS (infra/modules/retention-purger,
                               validado de forma independiente)
npm run terraform:format       PASS (recursivo, incluye el módulo)
npm run terraform:validate     PASS (raíz infra/, sin cambios)
npm run security                PASS (0 vulnerabilidades en dependencias de
                               producción)
npm run sync:check              PASS
```

`npm run test:e2e` no se ejecuta para el flujo de borrado en Playwright
(`e2e/foundation.spec.ts`): el modal se cubre con pruebas de integración
de React Testing Library contra el adaptador mock, consistente con el
resto del cliente en este repositorio.
