# Diagnóstico de una galería vacía

Una subida completada sólo confirma que S3 recibió el archivo. ENROLLED
confirma la inscripción facial; no confirma que PhotoMatcher haya terminado.
Una respuesta de galería con cero fotos tampoco demuestra ausencia de
coincidencias definitivas.

## Primera comprobación

1. Recargar la galería. Si aparecen fotos, el matching terminó después de la
   consulta inicial. El cliente refresca cada cuatro minutos; #107 corrige la
   transición de vacío a fotos en ese refresco.
2. Si continúa vacía, comprobar que foto y selfie pertenecen al mismo evento.
3. Consultar los estados y logs del entorno correcto con una sesión temporal
   autorizada. No enviar fotos, tokens o enlaces privados a GitHub.

## Diagnóstico con AWS CLI

La herramienta de sólo lectura usa AWS CLI, valida cuenta y región y muestra
únicamente metadatos permitidos de los logs. No consulta imágenes, caras,
tokens ni datos de contacto. No invoca Lambdas ni recibe mensajes SQS.

```sh
AWS_PROFILE=<perfil-temporal-autorizado> \
FINDLY_AWS_ACCOUNT_ID=<cuenta-verificada> \
node scripts/diagnose-matching.mjs --environment production --hours 3
```

Puede acotarse a un evento con `--event-id <eventId>`; es el identificador del
evento, nunca el token de galería ni el identificador de inscripción. La
herramienta limita cada consulta a 200 registros y advierte si hay más páginas.
Una ventana incompleta no permite afirmar ausencia de fallos.

Permisos de lectura necesarios: `sts:GetCallerIdentity` y
`logs:FilterLogEvents` sobre los grupos de SelfieIndexer, PhotoMatcher y
GalleryReader del entorno. La herramienta no crea roles ni modifica políticas.
El usuario de invitaciones Cognito no dispone de estos permisos.

## Interpretar las señales

| Señal                                                                  | Interpretación y siguiente comprobación                                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Inscripción UPLOAD_PENDING                                             | Confirmar PUT y notificación `.selfie.jpg`; no buscar matches todavía.                                                             |
| Inscripción PROCESSING                                                 | Revisar SelfieIndexer y sus reintentos; no confundirlo con matching terminado.                                                     |
| Inscripción FAILED                                                     | Revisar el nombre de error saneado y detección de rostro. No bajar el umbral.                                                      |
| `ResourceNotFoundException` en `index_faces` antes de `selfie_indexed` | La colección puede no existir aún. Correlacionar por evento y observar la siguiente entrega SQS. No crear colecciones manualmente. |
| `photo_matching_failed`, `failedCount > 0`                             | El lote solicita reentrega parcial; revisar error y paso, mensajes pendientes y DLQ.                                               |
| `photo_processed`                                                      | La foto terminó de procesarse; puede haber cero coincidencias. No equivale a un match.                                             |
| `gallery_request`, 200 y `photoCount: 0`                               | La lectura fue válida y vacía en ese instante; comparar su hora con procesamiento posterior.                                       |
| `gallery_request`, 200 y fotos, pero pantalla vacía                    | Revisar estado/refresco del cliente; #107 cubre vacío → fotos.                                                                     |
| Fotos procesadas antes de ENROLLED, sin coincidencias posteriores      | El matching histórico al inscribirse sigue pendiente en #87. No prometer que recargar reprocesará fotos.                           |

Para las colas, usar `sqs:GetQueueAttributes` con
`ApproximateNumberOfMessages`, `ApproximateNumberOfMessagesNotVisible` y
`ApproximateNumberOfMessagesDelayed`, tanto en `findly-{environment}-photos-queue`
como en `findly-{environment}-photos-dlq`. Son contadores aproximados:
mensajes invisibles suelen indicar una entrega en curso o espera del timeout;
no demuestran éxito ni fallo. No usar ReceiveMessage para inspeccionar:
alteraría la visibilidad del trabajo real.

El timeout de visibilidad configurado es 180 segundos y la DLQ recibe el
mensaje después de tres recepciones fallidas. Esos límites no son una promesa
de que la galería estará lista en tres minutos. No redrive, resubir, invocar
manualmente ni borrar mensajes sin analizar causa, idempotencia y autorización.

Si hace falta contrastar almacenamiento, consultar sólo las claves del evento
y estados, y contar MATCH por inscripción con salida agregada. No descargar
items completos ni hacer un Scan global para una incidencia localizada. El
lector filtra matches sin metadatos de foto válidos: contar MATCH no acredita
por sí solo que todas las imágenes se puedan entregar.

## Evidencia de soporte

Registrar entorno, ventana horaria, cantidades, nombres de error/paso y
resultado de recargar. Distinguir datos observados de hipótesis. Excluir
selfies, fotografías reales, FaceIds, identificadores de asistentes, correos,
tokens, URLs firmadas, cuerpos de mensajes y errores SDK en texto libre.

La [evidencia de #107](../evidence/issue-107-gallery-refresh.md) documenta el
caso observado y los límites de la corrección. #87 y #88 conservan su alcance
pendiente; este diagnóstico no habilita correo SES ni cierra #49.
