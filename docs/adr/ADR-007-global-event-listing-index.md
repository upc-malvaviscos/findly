# ADR-007: Índice global para listar eventos administrativos

## Estado

ACEPTADO (2026-09-17)

## Decisión

La tabla única añade GSI2 con `GSI2PK = ENTITY#EVENT` y
`GSI2SK = {date}#{eventId}`. Las Lambdas administrativas consultarán este
índice en vez de ejecutar `Scan` sobre la tabla principal.

## Consecuencias

Todos los organizadores autenticados ven el mismo listado de eventos. La
propiedad por organizador no forma parte del MVP y requerirá una decisión y un
índice distinto si se incorpora. El índice mantiene el acceso de lectura
acotado y ordenado sin ampliar los permisos IAM a `dynamodb:Scan`.
