# 06 - Inscripción facial e indexación Rekognition

## Objetivo
Procesar asíncronamente las selfies subidas por los asistentes, indexando la información vectorial del rostro en AWS Rekognition de forma segura y actualizando el estado de la inscripción.

## Arquitectura de Procesamiento Asíncrono Backend

### Flujo de Eventos S3 -> Lambda
1. La subida finalizada del archivo selfie a S3 (`events/{eventId}/selfies/{registrationId}.jpg`) dispara un evento `ObjectCreated:Put` a la Lambda de inscripción facial.
2. La Lambda ejecuta la API `IndexFaces` de AWS Rekognition sobre la colección del evento (`findly-collection-{eventId}`), pasando `ExternalImageId = registrationId`.
3. Transiciones deterministas del registro en DynamoDB:
   - `UPLOAD_PENDING` -> `PROCESSING` -> `ENROLLED` (en caso de éxito).
   - `UPLOAD_PENDING` -> `PROCESSING` -> `FAILED` (si no se detecta ningún rostro o la calidad es insuficiente).

### Principios de Idempotencia y Resiliencia
- Si el evento S3 se reintenta, la Lambda comprueba si `registrationId` ya posee `status == 'ENROLLED'`, evitando llamadas redundantes a Rekognition.
- Guardar únicamente el `FaceId` devuelto por Rekognition en DynamoDB. Nunca almacenar vectores biométricos crudos en la base de datos.

## Especificación del Polling de Estado en Frontend

### Hook de Polling (`useEnrollmentStatus`)
- Tras completar la subida a S3, el cliente web invoca `GET /registrations/{registrationId}/status` a intervalos de 1.5 segundos.
- Límite de reintentos: Máximo 10 intentos (15 segundos totales).
- Si la respuesta es `ENROLLED`, la UI transiciona a la pantalla de éxito.
- Si la respuesta es `FAILED`, la UI muestra el motivo de fallo (ej: "No se detectó un rostro claro. Por favor, sube otra imagen con mejor iluminación").

## Criterios de Aceptación
- Un archivo con un rostro válido indexa correctamente en Rekognition y actualiza DynamoDB a `ENROLLED`.
- Una imagen sin rostro o corrupta transiciona a `FAILED` de forma segura sin romper la ejecución de la Lambda.
- Los reintentos de eventos S3 duplicados son idempotentes y no duplican vectores en Rekognition.
