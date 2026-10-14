# 09 - Consentimiento, auditoría, retención de datos y derecho al olvido

## Objetivo

Garantizar el cumplimiento estricto del Reglamento General de Protección de Datos (GDPR), minimizando los datos biométricos, auditando el consentimiento y proporcionando mecanismos automatizados mediante AWS EventBridge Scheduler, DynamoDB TTL y Rekognition `DeleteFaces` para la purga y derecho al olvido.

## Alineación con AWS Well-Architected Framework

- **Seguridad y Privacidad**: Cumplimiento legal GDPR, minimización biométrica y trazabilidad auditable de consentimiento.
- **Sostenibilidad y FinOps**: Purga automatizada de datos vencidos en S3, Rekognition y DynamoDB mediante EventBridge Scheduler y TTL.

## Especificación Técnica de Retención y Purgado AWS

- **DynamoDB TTL**: Atributo `ttl` (epoch en segundos).
- **S3 Lifecycle Rules**: Reglas de expiración automática de objetos.
- **EventBridge Scheduler & Lambda `RetentionPurger`**: Cron diario (`cron(0 3 * * ? *)`) que invoca `DeleteCollectionCommand` para eventos caducados.

> **Nota de implementación (issue #10):** la spec no fija memoria ni
> timeout para esta Lambda. Se usan 512 MB / 300 s como valores propios
> razonables para un trabajo por lotes sin presión de latencia de usuario
> (a diferencia de `SelfieIndexer`/`PhotoMatcher`, que sí tienen números
> explícitos en sus specs respectivas).

- **Derecho al Olvido (`DELETE /registrations/{registrationId}`)**: Requiere el `X-Gallery-Token` opaco; su SHA-256 debe pertenecer a la inscripción solicitada. Invoca `DeleteFacesCommand` en Rekognition, elimina la selfie en S3 y borra los registros `REG#*`, `MATCH#*` y `TOKEN#*` en DynamoDB.

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Implementar la Lambda de Purga por Retención

- En `build/lambdas/retention/index.ts`, consulta eventos caducados en DynamoDB.
- Llama a `DeleteCollectionCommand` de Rekognition y borra el prefijo S3 del evento.

### Paso 2: Crear el Handler de Derecho al Olvido

- En `build/lambdas/api/deleteRegistration.ts`, procesa la petición `DELETE /registrations/{id}`.
- Borra de Rekognition, S3 y DynamoDB en una secuencia limpia con registro de auditoría sin PII.

### Paso 3: Componente Frontend de Revocación

- En React, crea `ErasureModal.tsx` con advertencia explicativa antes de enviar la petición de borrado.

## Errores Comunes a Evitar (Pitfalls)

- ❌ **ERROR**: Olvidar eliminar el vector facial de Rekognition (`DeleteFacesCommand`) al procesar el derecho al olvido.
  - _Solución_: La imagen en S3 y el vector en Rekognition deben eliminarse simultáneamente.
- ❌ **ERROR**: Dejar registros huérfanos en DynamoDB.
  - _Solución_: Asegúrate de borrar `REG#{id}`, todas las coincidencias `MATCH#{photoId}` asociadas y el `TOKEN#{tokenHash}`.

## Estado de implementación (issue 70)

La Lambda de borrado y su módulo Terraform están implementados; el handler
pagina todas las coincidencias y mantiene el token si falla una dependencia.
El purgador usa Query GSI2, elimina objetos y colección, recorre registros
DynamoDB y borra metadatos al final para permitir reintentos. La referencia
opcional `tokenHash` sigue ADR-010; los tokens legacy conservan TTL eventual.

Evidencia: `docs/evidence/issue-70-erasure-retention.md`.

## Lista de Verificación Pre-PR (Junior Checklist)

- [x] Borrado desplegado elimina selfie, FaceId y registros DynamoDB con datos
      sintéticos en el entorno efímero de la PR #71.
- [x] Galería 200 → DELETE 204 → galería 404 con el mismo token en AWS efímero.
- [x] Pruebas unitarias de paginación, retención y errores parciales.
- [x] Cron real ejecuta purga y prueba ausencia de datos en AWS (PR #84).

Las dos primeras casillas se acreditan con el run AWS 36482560393 de la PR #71;
las pruebas unitarias con mocks SDK no las certifican. La invocación manual del
purgador en ese run no acreditaba la ejecución programada del cron ni el
servicio TTL real; el run AWS 36991833773 de la PR #84, detallado abajo, sí
acredita la invocación real del Scheduler. Véase
`docs/runbooks/issue-70-acceptance.md`.

La aceptación efímera ejecuta `scripts/deployed-scheduler-retention.mjs`
después del smoke existente. Acelera temporalmente el mismo schedule a un
minuto, observa la eliminación automática de un evento sintético vencido y la
conservación de otro vigente, y restaura el cron diario. `DescribeTimeToLive`
verifica que la tabla usa `ttl` habilitado. El
[run AWS 36991833773](https://github.com/upc-malvaviscos/findly/actions/runs/36991833773/job/110793272543)
de la PR #84 confirmó la invocación real de EventBridge Scheduler: purgó el
evento sintético vencido y conservó el vigente. La eliminación eventual de un
ítem por el servicio TTL requiere observación separada en un entorno
persistente; no se marca como acreditada por este probe.

`scripts/deployed-ephemeral-erasure.mjs` añade un escenario de fallo parcial y
reintento: una clave de selfie inválida en el localizador falla el DELETE
desplegado después de marcar `erasureRequestedAt` y `cleanupState=DELETING`,
pero antes de borrar ningún recurso; la inscripción, sus coincidencias y su
token sobreviven. Reparar la clave y reintentar con el mismo token completa el
borrado. El script espera y lee la línea ERROR real de CloudWatch Logs de ese
fallo inducido y comprueba que no contiene `registrationId`, token ni la clave
de selfie.

## Localizador durable y productores concurrentes (ADR-013)

Los registros nuevos mantienen RETENTION sin TTL, independiente de REG.
El borrado recupera FaceIds conocidos y caras descubiertas por identificador
externo. El cron también reconcilia borrados de eventos activos. La purga
mantiene metadatos durante la barrera URL/asíncrona y borra la colección al
final. Las colecciones legacy sin origen confirmado requieren migración.

La evidencia local cubre REG desaparecido por TTL, caras no persistidas,
reconciliación de subidas tardías, paginación y conservación de referencias
en errores. No sustituye las pruebas AWS ni acredita ejecución del cron real.

<!-- requirement: REQ-ERASURE-RETENTION -->

Trazabilidad `REQ-ERASURE-RETENTION`: [#10](https://github.com/upc-malvaviscos/findly/issues/10) · [evidencia](../docs/evidence/issue-70-erasure-retention.md).
