# ADR-003: Retención de datos biométricos autorizados

## Estado

**ACEPTADO** (2026-09-03)

## Decisión

Findly almacenará selfies y fotos únicamente en buckets S3 privados. DynamoDB conservará el `FaceId` de Rekognition, nunca vectores biométricos ni imágenes crudas. Cada entidad llevará TTL y el derecho al olvido eliminará S3, Rekognition y DynamoDB.

## Consecuencias

Se minimiza la persistencia biométrica y se puede demostrar la purga mediante registros de auditoría. El plazo inicial de retención es siete días y será configurable por evento.
