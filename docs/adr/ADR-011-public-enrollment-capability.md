# ADR-011: inscripción pública y capacidad de galería

- Estado: aceptado por la persona responsable el 2026-09-28.
- Issues: #7, #22 y #70.

## Decisión

`POST /events/{eventId}/registrations` devuelve `galleryToken` junto con
`registrationId`, `uploadUrl` y `expiresInSeconds`. El token contiene 32 bytes
aleatorios, codificados en base64url. Sólo su SHA-256 se persiste en DynamoDB.
Las nuevas selfies usan el sufijo `.selfie.jpg` para permitir filtros S3
sin solapamiento con `.photo.jpg`; el parser conserva claves legacy.

La inscripción guarda `tokenHash` opcional para permitir borrar el token sin
un Scan; los registros antiguos siguen siendo compatibles.

`GET /registrations/{registrationId}/status` requiere `X-Gallery-Token`.
El registro TOKEN existente proporciona eventId y registrationId y resuelve la
clave primaria de inscripción sin índices nuevos. Se verifica que el ID pedido
coincida y que la capacidad no haya caducado. No se permite consultar el estado
por conocer únicamente un registrationId.

La SPA conserva el token en memoria y presenta el enlace de galería después de
ENROLLED. No añade un proveedor de correo ni persiste el token en localStorage.
La caducidad coincide con createdAt + retentionDays del evento.

## Fiabilidad del indexador

Un claim condicional con lease de 30 segundos serializa la indexación y permite
recuperar PROCESSING tras un fallo. Una actualización final condicionada al
claim y a la ausencia de `erasureRequestedAt` no recrea una inscripción borrada. Si falla esa condición después de
IndexFaces, se limpia el FaceId generado. Los reintentos usan el mismo objeto y
ExternalImageId; un registro terminal no vuelve a indexarse. Los fallos AWS
transitorios se propagan para que S3 reintente; imagen inválida o sin rostro
termina en FAILED.

La continuación aprobada incorpora ADR-013, ADR-014 y ADR-015: REG, TOKEN y
RETENTION sin TTL se crean juntos; el PUT de selfie firma `If-None-Match: *`
y caduca como máximo a los 300 s o con el evento. El FaceId se guarda primero
como candidato durable y la reconciliación usa ListFaces por identificador
externo, incluso si REG desaparece. La colección se resuelve por entorno.
Los marcadores no se retiran antes de la purga del evento. Una URL emitida
antes de DELETE puede recrear un objeto borrado hasta su caducidad, por lo que
el consumidor y el cron siguen limpiando las entregas tardías.

## Verificación

Las pruebas unitarias cubren consentimiento, transacción de registro/token,
privacidad de la respuesta, autorización y caducidad, estados terminales,
lease, fallos transitorios y borrado concurrente. La entrega y deduplicación
reales en S3/Rekognition requieren la evidencia del stack AWS efímero.
