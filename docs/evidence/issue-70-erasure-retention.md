# Issue 70: borrado y retención

## Resultado AWS posterior: PR #71

El [run 36482560393](https://github.com/upc-malvaviscos/findly/actions/runs/36482560393)
desplegó un stack efímero y comprobó con datos sintéticos galería 200 → DELETE
204 → galería 404, ausencia de REG/MATCH/TOKEN/selfie y borrado del FaceId
indexado. También invocó manualmente el purgador: eliminó datos vencidos sin REG
y conservó eventos activos. Destruyó 103 recursos y el estado remoto PR71 quedó
vacío. La desaparición de REG por TTL fue simulada; faltan ejecución real del
Scheduler y observación del servicio TTL. Los apartados siguientes conservan
las pruebas y límites de la fase de preparación anterior a ese run.

## Probe programado preparado para la siguiente PR

`scripts/deployed-scheduler-retention.mjs` se ejecuta después del smoke AWS
existente, cuando ya no quedan fixtures que puedan interferir. Lee el schedule
de Terraform y confirma su Lambda de destino, cron diario y ventana flexible
desactivada. Lo deshabilita durante la siembra, crea dos eventos sintéticos
(vencido y vigente) con objetos S3 y colecciones Rekognition aisladas por PR,
espera su visibilidad en GSI2 y activa el mismo schedule a `rate(1 minute)`.
Sin invocar manualmente la Lambda, espera como máximo cuatro minutos a que
desaparezcan el evento vencido, su objeto y su colección; comprueba que el
evento vigente y sus recursos continúan. Restaura el cron original y limpia
los fixtures incluso ante un fallo. El `destroy` del workflow conserva su
ejecución obligatoria.

El probe exige también `DescribeTimeToLive`: estado `ENABLED` y atributo `ttl`.
Esta lectura acredita configuración, no una eliminación ejecutada por el
servicio TTL. AWS puede tardar días en borrar un ítem vencido; no existe aún
una tabla Findly persistente donde observarlo. Esta sección describe una
prueba preparada: no se marca Scheduler ni TTL como evidencia AWS hasta
registrar un run desplegado exitoso y su teardown.

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
alinearse con el evento; la ejecución programada del cron sigue pendiente de prueba.

Validación local: 29 pruebas unitarias pasan; typecheck, ESLint de los cuatro
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

Esta suite aislada **no** demuestra borrado de FaceId real ni ejecución de Scheduler:
los JPEG mínimos no representan personas, no producen evidencia biométrica y
no se inventa un FaceId. La prueba de biometría requiere una imagen sintética
aprobada indexable; el cron necesita evidencia de invocación programada.

Permisos del runner, limitados al stack de PR: `dynamodb:PutItem`, `GetItem`,
`DeleteItem` sobre su tabla; `dynamodb:Query` sobre GSI2; `s3:PutObject`,
`GetObject`, `DeleteObject` sobre `events/*` y `s3:ListBucket` para comprobar
ausencia mediante ListObjectsV2, con condición de prefijo `events/*`; `lambda:InvokeFunction` exclusivamente
sobre RetentionPurger del PR. No se concede ninguno desde este script.
El rol de la Lambda conserva sus permisos propios para borrar colección,
objetos y registros. Este script se preparó y validó estáticamente antes de la
aceptación integrada;
el IAM del runner fue aprobado y aplicado durante la integración de PR #71.
La aceptación AWS integrada posterior se documenta en
`docs/runbooks/issue-70-aws-review.md` y `issue-70-integration.md`.

El borrado marca `erasureRequestedAt` atómicamente antes de borrar recursos,
sin recrear REG ausentes; el FaceId se obtiene de la respuesta de esa escritura.
Lecturas de autorización e inscripción son consistentes. Retención marca REG
antes del barrido MATCH. SelfieIndexer y PhotoMatcher deben respetar ese
marcador para evitar nuevos vectores/coincidencias durante el borrado.

Compatibilidad selfie: el borrado usa `selfieS3Key` almacenado únicamente si
coincide con la clave canónica `.jpg` legacy o `.selfie.jpg` del mismo
evento/registro. Sin campo usa el helper actual. Una clave ajena falla antes
de borrar recursos y produce diagnóstico sin imprimir la clave ni PII.

## Decisiones resueltas y límites de evidencia

La persona responsable aprobó el localizador sin TTL, selfies condicionales y
aislamiento por entorno. La ampliación siguiente cubre desaparición de REG y
reconciliación de FaceIds no persistidos; ya no son decisiones pendientes.
Los marcadores conservan identificadores sensibles, no datos anónimos.
Los tests locales cubren fallos y subidas tardías. El run integrado acreditó el
borrado AWS; falta observar el cron. Ese criterio mantiene #10 abierta.

## Ampliación durable aprobada

ADR-013 añade RETENTION sin TTL para descubrir TOKEN/MATCH/FaceIds cuando
REG ya desapareció. ListFaces paginado filtra exactamente registrationId,
sin incluir caras de fotografías ni otros asistentes. DELETE conserva el
localizador; el cron reconcilia eventos activos borrados y purga eventos
vencidos después de una barrera URL/asíncrona. La colección se borra al final.
FaceIds y claves de inscripción son sensibles: no se imprimen.

Los permisos Lambda añaden ListFaces en su colección aislada, GetItem para
validar localizadores y UpdateItem para referencias y marcadores. No se
amplía IAM de entornos demo/production. Durante la integración se aprobaron
y aplicaron políticas adicionales del rol CI externo, limitadas al alcance
PR #71 documentado en el runbook, y se ejecutó provisión/teardown AWS efímero.

Validación de esta ampliación: 41 pruebas enfocadas (borrado, retención y
localizador), suite unitaria completa con gate de cobertura, typecheck,
ESLint enfocado, Markdownlint, Terraform fmt y TFLint de ambos módulos.
La aceptación AWS integrada se ejecutó después; el cron real permanece pendiente. El rol
RetentionPurger incluye además GetItem
para validar el origen de localizadores cuando REG legacy conserva FaceId.
