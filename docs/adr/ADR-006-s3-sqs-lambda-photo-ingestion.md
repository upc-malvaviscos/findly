# ADR-006: Ingesta de fotos S3 a SQS a Lambda

## Estado

**ACEPTADO** (2026-09-03)

## Decisión

La carga de fotos de evento notificará S3, que entregará eventos a SQS; una Lambda consumidora ejecutará el matching con Rekognition.

## Consecuencias

SQS desacopla la carga del procesamiento, permite reintentos y limita la concurrencia. La Lambda será idempotente respecto a cada foto y conservará evidencia de errores sin exponer PII.
