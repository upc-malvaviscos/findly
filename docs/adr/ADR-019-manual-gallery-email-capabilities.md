# ADR-019: envío manual de galerías y capacidades adicionales

## Estado y alcance

Aceptado por la persona responsable el 2026-10-04 para la issue #86.
DynamoDB se mantiene para este cambio. La issue #49 sigue abierta: este ADR
no sustituye su análisis global ni decide los contratos de #87/#89.
Dominio elegido: `findly.barcelona`; remitente: `info@findly.barcelona`;
DNS: Acens. No autoriza aplicar AWS, cambiar DNS ni enviar correo real.

## Contrato administrativo e idempotencia

- `POST /admin/events/{eventId}/gallery-emails`, body `{ operationId: UUID }`:
  devuelve `202` y los contadores. Cognito JWT en API Gateway; el handler
  exige también el `sub` de la identidad validada por Gateway.
- `GET /admin/events/{eventId}/gallery-emails/{operationId}`: progreso sin
  destinatarios, emails, claves internas ni tokens.
- La SPA genera un UUID por confirmación. Doble clic queda bloqueado y un
  fallo de respuesta conserva el UUID. Confirmar otro envío genera otro UUID.
- `EVENT#id/EMAIL#uuid`: operación, revisión, checkpoint y contadores agregados.
  Escritura condicional evita reemplazar operaciones; un reintento recupera el
  hueco entre persistencia y SQS. Tras diez minutos sin avance, GET muestra
  `STALLED` y permite reanudar la misma operación; no confirma un fallo SES.
- SQS FIFO usa un grupo global y batch de uno. Cada mensaje procesa una
  inscripción, continúa por clave y actualiza revisión/contador condicionados.
  Encola continuación antes del checkpoint; reintentos usan el estado durable
  `REG#id/EMAIL#uuid`. No hay Scan global ni índice nuevo.
- No se ofrece una instantánea de participantes: se recorren los registros
  existentes en cada página. Nuevas inscripciones concurrentes pueden entrar
  en un envío; si llegan detrás del checkpoint, requieren otra confirmación.

## Elegibilidad y límites de concurrencia

Email obligatorio en nuevas solicitudes UI/API. `RegistrationEntity.email`
permanece opcional para datos históricos: una inscripción vigente sin email
válido se cuenta aparte y conserva su galería.

Antes de SES se requieren evento OPEN y vigente, inscripción ENROLLED,
`consentTimestamp`, TTL vigente y ausencia de `erasureRequestedAt`, un match
del evento y una foto vigente sin barrera de borrado cuyo objeto exista en S3.
Se paginan matches, se consulta la supresión regional de SES y se comprueban
condiciones de evento/inscripción/foto al reclamar el destinatario. Se vuelve a
validar tras el claim y después de la pausa de 1,1 s que acota envíos globales.
No se envía desde el matching; no hay campañas ni selección individual.

DynamoDB y SES no comparten transacción. La barrera protege frente al borrado
observado antes de la última lectura; un borrado posterior no cancela una
petición SES en vuelo. El enlace adicional exige inscripción existente y no
revocada al abrir la galería. No se promete ausencia de mensajes después de una
revocación simultánea ni cancelación de mensajes ya aceptados.

## Enlaces, revocación y retención

Se genera un token nuevo de 32 bytes aleatorios en memoria por intento de
emisión. Sólo se guarda SHA-256 en `TOKEN#hash/METADATA` y la relación inversa
`REG#id/TOKEN#hash`. Los tokens anteriores siguen válidos; nunca se reconstruye
su hash ni se persiste el token en claro. La expiración se limita a la menor
caducidad de inscripción/evento. El email tiene texto y HTML escapado, enlace
HTTPS propio y caducidad; sin CC, adjuntos, acortadores ni tracking añadido.
Compartir el enlace también comparte la capacidad de borrar la inscripción.

Los índices inversos no tienen TTL: DELETE y purga eliminan primero cada TOKEN
externo y después su referencia. El estado de destinatario no guarda email ni
URL y se limpia al borrar la inscripción o purgar su evento. Operación y estado
individual caducan con la retención original; la operación conserva únicamente
contadores y no enumera destinatarios. Los IDs de inscripción siguen siendo
datos sensibles aunque no contengan email. Feedback tardío no los recrea.

SES mantiene su lista de supresión para BOUNCE/COMPLAINT. Sus direcciones,
retención y acceso corresponden a configuración regional de AWS; no se copian
a DynamoDB ni se eliminan automáticamente al borrar la inscripción, para no
reautorizar envíos a direcciones suprimidas. Incluir esta lista en la revisión
operativa de solicitudes de privacidad. El feedback SNS/SQS puede contener PII,
pero no el cuerpo de correo: acceso restringido y retención de cola de una hora.
No habilitar delivery logging SNS ni registrar cuerpos, cabeceras o errores
crudos. Los handlers propagan errores genéricos sin contenido sensible.

## Recuperación y observabilidad

El claim `SENDING` se persiste antes de llamar a SES. SDK SES sin reintentos
ocultos. Aceptado significa que SES devolvió `MessageId`, no entrega al buzón.
Rechazos explícitos se cuentan como fallidos. Throttling explícito pasa a RETRY
para que SQS reintente; fallos de transporte/respuestas ambiguas o un claim
SENDING abandonado se cuentan como inciertos, sin otro envío automático.
Un nuevo envío manual puede reenviar y debe mostrar ese riesgo al administrador.

Contadores: aceptados, omitidos, sin email válido, fallidos, inciertos, rebotes
permanentes y quejas. SES configuration set aplica supresión y publica feedback
SNS→SQS; actualizaciones condicionales evitan doble conteo y resurrección.
Ambas colas tienen DLQ y alarmas. Trabajo/feedback usan concurrencia máxima 2;
el único grupo FIFO limita a un worker de envío efectivo. Tras cinco fallos,
requiere corregir la causa y reanudar/redrive desde el runbook. Un fallo
persistente de un destinatario detiene esa operación en su checkpoint.

## Configuración y validación

La identidad SES compartida vive en `infra/email-identity`, con estado separado
y `prevent_destroy`. El módulo por entorno se habilita sólo con identidad ARN,
remitente y origen HTTPS configurados. No se modifica el rol compartido de CI ni
se habilita SES en el stack efímero de PR; sus pruebas de inscripción incluyen
email sintético. Las pruebas de correo usan SDK simulado y navegador simulado:
no demuestran IAM, supresión, DNS ni recepción real.

Requisitos externos antes de activar: identidad/DKIM, MAIL FROM/SPF y DMARC en
Acens, SES fuera de sandbox, ruta HTTPS de galería operativa, revisión de
permisos de despliegue y recepción en proveedores distintos. Ver
[runbook](../runbooks/gallery-email-ses-acens.md) y
[evidencia](../evidence/issue-86-gallery-email.md).
