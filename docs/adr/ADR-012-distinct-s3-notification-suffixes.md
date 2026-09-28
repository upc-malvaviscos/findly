# ADR-012: sufijos distintos para notificaciones S3

## Estado

Aprobado por la persona responsable el 28 de septiembre de 2026, dentro de #70.

## Contexto

Selfies y fotos comparten un bucket y el prefijo `events/`. S3 rechaza dos
notificaciones del mismo evento con filtros superpuestos `events/` y `.jpg`,
aunque se declaren en un único recurso Terraform. La nota anterior de #7
asumía que ambos destinos recibirían los mismos objetos, pero no es una
configuración admitida por S3.

Referencia: [filtros de notificación S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-filtering.html).

## Decisión

Conservar las carpetas, diferenciando nuevas cargas:

- Selfie: `events/{eventId}/selfies/{registrationId}.selfie.jpg`.
- Foto: `events/{eventId}/photos/{photoId}.photo.jpg`.

Un único `aws_s3_bucket_notification` del módulo photo-matching declara los
filtros `.selfie.jpg` hacia SelfieIndexer y `.photo.jpg` hacia SQS. Los parsers
aceptan también claves históricas `.jpg` y los lectores usan la clave guardada.
No se migran ni borran objetos existentes. Las URLs PUT anteriores duran 300 s;
antes del cambio desplegado, esperar su vencimiento y registrar/reprocesar las
cargas en curso. Las notificaciones nuevas no capturan nuevas escrituras con
sufijo antiguo; no se presenta el parser compatible como garantía de trigger.

## Consecuencias

No se añade SNS/EventBridge al pipeline de ingestión. Permanece el único bucket,
la purga por `events/{eventId}/` y los permisos por carpetas. Los sufijos deben
actualizarse juntos en productores, parsers, fixtures y Terraform. El plan
AWS debe confirmar filtros no solapados y preservar los recursos existentes.
