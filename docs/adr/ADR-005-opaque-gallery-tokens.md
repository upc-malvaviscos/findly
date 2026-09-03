# ADR-005: Tokens opacos SHA-256 para galerías temporales

## Estado

**ACEPTADO** (2026-09-03)

## Decisión

Los enlaces de galería usarán tokens aleatorios opacos. DynamoDB almacenará únicamente su hash SHA-256 como clave de consulta; los tokens y URLs prefirmadas no se registrarán en texto claro.

## Consecuencias

La URL no expone identidad, correo ni `registrationId`. Los tokens caducan con el TTL y las URLs S3 `GET` se renuevan antes de sus cinco minutos de vigencia.
