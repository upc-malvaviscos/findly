# Issue 70: borrado y retención

El módulo `delete-registration` expone el contrato ya definido
`DELETE /registrations/{registrationId}` y restringe IAM a lectura/borrado
de tabla, borrado de selfies y `DeleteFaces` sobre colecciones Findly.
Los logs conservan 14 días; API Gateway controla CORS.

El handler recorre todas las páginas de coincidencias antes de eliminar
inscripción y token. Si una dependencia falla, conserva el token para
reintentar. Tras un borrado completado, el token desconocido devuelve 404.

El purgador consulta GSI2 `ENTITY#EVENT`, sin permisos Scan, y conserva
la política existente `createdAt + retentionDays`. Un error individual de
S3 DeleteObjects aborta el éxito; el siguiente cron puede reintentar.
Los nombres incluyen entorno para aislar stacks.

## Validación y límites

Las pruebas unitarias cubren paginación, fallos parciales, header sin
sensibilidad a mayúsculas, eventos vencidos/no vencidos y errores S3.
Estas pruebas usan mocks SDK y no prueban AWS desplegado ni el cron real.

La purga también recorre registros de evento y coincidencias en DynamoDB,
elimina tokens cuyo hash está referenciado y conserva metadatos hasta terminar.
El ADR-010 registra la decisión aprobada. Los tokens legacy sin referencia
inversa permanecen bajo TTL eventual. La política de TTL de productores debe
alinearse con el evento; el cron desplegado y AWS siguen pendientes de prueba.

Validación local: 24 pruebas unitarias pasan; typecheck, ESLint de los cuatro
archivos TypeScript, Markdownlint y Terraform validate de ambos módulos pasan.
Terraform fmt aplicado. Ninguna validación ha ejecutado apply AWS.

Un fallo individual de DeleteFaces conserva el registro y token para reintento.

## Smoke AWS reproducible

`scripts/deployed-ephemeral-erasure.mjs` requiere outputs del stack efímero:
`EPHEMERAL_API_ENDPOINT`, `EPHEMERAL_TABLE_NAME` (acepta también
`EPHEMERAL_DYNAMODB_TABLE_NAME`), `EPHEMERAL_UPLOADS_BUCKET_NAME` y
`EPHEMERAL_RETENTION_FUNCTION_NAME`. Sólo usa credenciales temporales del
proceso; no imprime tokens, URLs firmadas ni datos de filas.

Siembra datos sintéticos, comprueba token incorrecto, galería 200 → DELETE
204 → galería 404 y ausencia de REG/MATCH/TOKEN/selfie. Repetir DELETE retorna
404, acorde al contrato de token revocado. Invoca el purgador manualmente y
comprueba ausencia de datos vencidos y conservación de los no vencidos.
El GSI se espera con un límite de 30 segundos; todo dato creado se limpia
al finalizar, también cuando falla una comprobación.

Esta suite **no** demuestra borrado de FaceId real ni ejecución de Scheduler:
los JPEG mínimos no representan personas, no producen evidencia biométrica y
no se inventa un FaceId. La prueba de biometría requiere una imagen sintética
aprobada indexable; el cron necesita evidencia de invocación programada.

Permisos del runner, limitados al stack de PR: `dynamodb:PutItem`, `GetItem`,
`DeleteItem` sobre su tabla; `dynamodb:Query` sobre GSI2; `s3:PutObject`,
`GetObject`, `DeleteObject` sobre `events/*` y `s3:ListBucket` para poder
distinguir HeadObject inexistente (404) de falta de permiso (403), con
condición de prefijo `events/*`; `lambda:InvokeFunction` exclusivamente
sobre RetentionPurger del PR. No se concede ninguno desde este script.
El rol de la Lambda conserva sus permisos propios para borrar colección,
objetos y registros. Este script está preparado y validado estáticamente;
su ejecución AWS y el IAM del runner son pendientes hasta integración.
