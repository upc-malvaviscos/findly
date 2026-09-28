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

Validación local: 23 pruebas unitarias pasan; typecheck, ESLint de los cuatro
archivos TypeScript, Markdownlint y Terraform validate de ambos módulos pasan.
Terraform fmt aplicado. Ninguna validación ha ejecutado apply AWS.
