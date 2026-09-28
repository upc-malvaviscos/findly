# ADR-010: Purga explícita de eventos y referencia de token

## Estado

ACEPTADO (2026-09-28), implementación del plan de issue 70.

## Decisión

La inscripción nueva guarda `tokenHash` opcional con SHA-256 del token,
para descubrir el registro TOKEN sin almacenar el secreto ni añadir índices.
El purgador consulta GSI2 `ENTITY#EVENT`, calcula la expiración con
`createdAt + retentionDays` y borra colección Rekognition y objetos S3.
Después recorre la partición del evento y las particiones de coincidencias,
borra tokens referenciados, inscripciones y fotografías. Borra los metadatos
al final: mientras quedan, un fallo puede reintentarse.

## Compatibilidad y consecuencias

Las inscripciones previas carecen de `tokenHash`; sus tokens mantienen el TTL
original, sin inventar una migración o un Scan. DynamoDB TTL es limpieza
secundaria eventual, no prueba de borrado inmediato. La expiración de los
registros nuevos debe alinearse con el evento y no con 30 días constantes.
Las consultas y borrados se paginan. S3 puede devolver errores individuales
aunque la petición HTTP tenga éxito: esos errores abortan la purga.
El cron real y AWS desplegado necesitan evidencia independiente de unitarias.

## Exclusión de escritores durante borrado

`erasureRequestedAt` es un marcador interno, sin cambiar estados públicos.
Borrado y purga lo establecen antes del barrido de coincidencias. Los
productores condicionan escrituras a su ausencia; SelfieIndexer debe limpiar
el FaceId si pierde la carrera al completar. El marcador se mantiene en
fallos parciales para reintentar sin habilitar nuevos datos.
