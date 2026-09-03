# 09 - Consentimiento, auditoría, retención de datos y derecho al olvido

## Objetivo
Garantizar el cumplimiento estricto del Reglamento General de Protección de Datos (GDPR), minimizando los datos biométricos, auditando el consentimiento y proporcionando mecanismos automatizados mediante AWS EventBridge Scheduler, DynamoDB TTL y Rekognition `DeleteFaces` para la purga y derecho al olvido.

## Alineación con AWS Well-Architected Framework
- **Seguridad y Privacidad**: Cumplimiento legal GDPR, minimización biométrica y trazabilidad auditable de consentimiento.
- **Sostenibilidad y FinOps**: Purga automatizada de datos vencidos en S3, Rekognition y DynamoDB mediante EventBridge Scheduler y TTL.

## Especificación Técnica de Retención y Purgado AWS
- **DynamoDB TTL**: Atributo `ttl` (epoch en segundos).
- **S3 Lifecycle Rules**: Reglas de expiración automática de objetos.
- **EventBridge Scheduler & Lambda `RetentionPurger`**: Cron diario (`cron(0 3 * * ? *)`) que invoca `DeleteCollectionCommand` para eventos caducados.
- **Derecho al Olvido (`DELETE /registrations/{registrationId}`)**: Invoca `DeleteFacesCommand` en Rekognition, elimina la selfie en S3 y borra los registros `REG#*`, `MATCH#*` y `TOKEN#*` en DynamoDB.

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Implementar la Lambda de Purga por Retención
- En `build/lambdas/retention/index.ts`, consulta eventos caducados en DynamoDB.
- Llama a `DeleteCollectionCommand` de Rekognition y borra el prefijo S3 del evento.

### Paso 2: Crear el Handler de Derecho al Olvido
- En `build/lambdas/api/deleteRegistration.ts`, procesa la petición `DELETE /registrations/{id}`.
- Borra de Rekognition, S3 y DynamoDB en una secuencia limpia con registro de auditoría sin PII.

### Paso 3: Componente Frontend de Revocación
- En React, crea `ErasureModal.tsx` con advertencia explicativa antes de enviar la petición de borrado.

## Errores Comunes a Evitar (Pitfalls)
- ❌ **ERROR**: Olvidar eliminar el vector facial de Rekognition (`DeleteFacesCommand`) al procesar el derecho al olvido.
  - *Solución*: La imagen en S3 y el vector en Rekognition deben eliminarse simultáneamente.
- ❌ **ERROR**: Dejar registros huérfanos en DynamoDB.
  - *Solución*: Asegúrate de borrar `REG#{id}`, todas las coincidencias `MATCH#{photoId}` asociadas y el `TOKEN#{tokenHash}`.

## Lista de Verificación Pre-PR (Junior Checklist)
- [ ] Ejecutar el flujo de borrado desde el cliente elimina selfie en S3, `FaceId` en Rekognition y registros en DynamoDB.
- [ ] La consulta posterior de la galería con ese token devuelve HTTP 404 Not Found.
- [ ] Las pruebas unitarias del purgador de retención pasan en verde.
