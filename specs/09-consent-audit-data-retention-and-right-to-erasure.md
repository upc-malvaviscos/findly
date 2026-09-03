# 09 - Consentimiento, auditoría, retención de datos y derecho al olvido

## Objetivo
Garantizar el cumplimiento estricto del Reglamento General de Protección de Datos (GDPR), minimizando los datos biométricos, auditando el consentimiento y proporcionando mecanismos automatizados para el ejercicio del derecho al olvido y purga por caducidad.

## Requisitos de Consentimiento y Auditoría
- **Trazabilidad de Consentimiento**: Cada registro almacena la versión del texto legal aceptado, fecha/hora exacta en formato ISO-8601 (`consentTimestamp`), dirección IP/User-Agent anonimizados y alcance del propósito.
- **Minimización de Datos**: Prohibido almacenar imágenes originales de selfies de forma indefinida. Tras la indexación en Rekognition, la selfie original se elimina o se marca con ciclo de vida corto en S3.

## Política de Retención y Borrado Automático
- **DynamoDB TTL**: Todos los ítems de registro, fotos y matches incluyen el atributo `ttl` (epoch en segundos). DynamoDB elimina automáticamente los ítems caducados sin coste operativo.
- **S3 Lifecycle Rules**: Reglas automatizadas en los buckets S3 para expirar y purgar objetos al cumplirse el período de retención del evento (`retentionDays`).
- **Lambda de Purgado**: Tarea programada (AWS EventBridge Scheduler) que elimina los vectores/rostros indexados (`DeleteFaces`) en AWS Rekognition para los eventos cuyo plazo de retención ha finalizado.

## Especificación Frontend del Derecho al Olvido (Right to Erasure)

### Flujo de Revocación de Consentimiento en UI
1. El usuario hace clic en "Eliminar mis datos biométricos" desde el pie de página de la galería o mediante formulario de solicitud con su token/código de registro.
2. `ErasureModal`: Modal de confirmación accesible con advertencia clara (destrucción irreversible de la selfie, la galería y eliminación de Rekognition).
3. Petición HTTP: `DELETE /registrations/{registrationId}` enviando el token de validación.
4. Respuesta UI: Confirmación inmediata de eliminación completa y redirección a la página principal.

## Criterios de Aceptación
- Un test de revocación demuestra la eliminación completa verificable: borrado de la selfie en S3, eliminación de `FaceId` en Rekognition, purga de registros en DynamoDB y anulación del token de galería.
- Ningún dato personal o biométrico permanece accesible tras la ejecución del derecho al olvido.
