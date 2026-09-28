# ADR-014: selfies inmutables y reconciliación de inscripción

- Estado: aceptado por la persona responsable el 2026-09-28.
- Issues: #7, #10, #22, #47 y #70.

## Decisión

Las URLs PUT de selfies firman `Content-Type: image/jpeg` y
`If-None-Match: *`. La SPA envía ambas cabeceras; omitir o cambiar la condición
invalida la firma y sobrescribir una clave existente devuelve 412 en S3.
La condición es write-once mientras existe el objeto: tras DELETE, la misma
URL todavía puede recrearlo hasta que caduque su firma.
Las URLs para fotografías conservan el contrato previo. La vigencia de la
selfie es como máximo 300 segundos y se reduce si el evento caduca antes.
CORS admite la nueva cabecera, pero no sustituye la autorización SigV4.

La inmutabilidad permite reintentar IndexFaces con la misma imagen, colección
y ExternalImageId, que Rekognition deduplica. Cada entorno usa su propio
namespace de colecciones (ADR-015), conservado como `collectionId` del locator.
No se borran colecciones globales legacy cuando su propiedad es ambigua.

## Locator durable

El locator durable se define en ADR-013. POST crea atómicamente REG, TOKEN y `EVENT#eventId / RETENTION#registrationId`.
El locator no tiene TTL, correo, consentimiento ni imagen; sólo referencias
necesarias para limpiar datos sensibles, `collectionId`, `tokenHash`,
`selfieS3Key`, los `faceIds` conocidos, vencimiento del PUT y estado de limpieza.
Antes de finalizar ENROLLED, el indexador añade el FaceId al StringSet durable.
Lo añade incluso si comenzó el borrado, para que una compensación fallida sea
recuperable. La finalización de REG sigue condicionada al claim y a la ausencia
del marcador de borrado. Polling devuelve 404 si existe ese marcador o si el
locator deja de estar ACTIVE.

Un crash puede ocurrir después de IndexFaces y antes de guardar el FaceId.
Por eso la limpieza de una inscripción borrada o caducada consulta ListFaces
paginado y filtra exactamente por ExternalImageId. No depende únicamente de
los IDs conocidos. Sólo consulta su colección del entorno. Si existe locator, verifica su
collectionId antes de actuar en AWS. Si la purga final ya eliminó el locator,
una notificación tardía sólo reconcilia la colección del namespace actual y
la clave canónica del bucket del entorno; nunca una colección global legacy. También elimina la selfie.
Los fallos individuales de DeleteFaces no se presentan como éxito.

Los tombstones se conservan hasta la purga del evento. El borrado de REG o TOKEN no revoca una URL PUT ya emitida. La caducidad de
la firma limita nuevos PUTs, pero no la entrega tardía de notificaciones S3;
el cron y las notificaciones repiten la reconciliación. Un HTTP de borrado y la convergencia
de operaciones concurrentes son evidencias distintas. No se promete ausencia
instantánea durante una operación AWS que todavía está en curso.

## Evidencia

Las pruebas cubren la firma real del SDK sin red, el header del navegador,
la transacción del locator sin TTL, vigencia acotada, candidatos durables,
lease, borrado concurrente, crash sin REG, paginación y fallos de limpieza.
Las garantías S3 403/412, IAM y la entrega tardía requieren el smoke AWS real.

[Referencia de IndexFaces](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_IndexFaces.html).
