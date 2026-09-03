# 06 - Inscripción facial e indexación Rekognition

## Objetivo
Procesar asíncronamente las selfies subidas por los asistentes, indexando la información vectorial del rostro en AWS Rekognition de forma segura y actualizando el estado de la inscripción.

## Alineación con AWS Well-Architected Framework
- **Fiabilidad**: Procesamiento asíncrono activado por eventos S3 con control de reintentos idempotentes.
- **Seguridad**: Prohibido almacenar imágenes crudas biométricas en base de datos; solo se almacena el identificador `FaceId`.

## Arquitectura de Procesamiento Asíncrono Backend

### Configuración Lambda (`SelfieIndexer`)
- **Runtime**: Node.js 24.x LTS.
- **Memoria**: `512 MB`, **Timeout**: `10 segundos`.
- **Variables de Entorno**: `TABLE_NAME`, `REKOGNITION_COLLECTION_PREFIX`.

### Flujo de Eventos S3 -> Lambda -> Rekognition
1. La subida finalizada del archivo selfie a S3 (`events/{eventId}/selfies/{registrationId}.jpg`) dispara un evento `ObjectCreated:Put` a la Lambda de inscripción facial.
2. La Lambda ejecuta `IndexFacesCommand` de AWS Rekognition sobre `findly-event-{eventId}` con `ExternalImageId = registrationId`, `MaxFaces = 1`, `QualityFilter = "AUTO"`.
3. Transiciones en DynamoDB: `UPLOAD_PENDING` -> `PROCESSING` -> `ENROLLED` (éxito) / `FAILED` (error o sin cara).

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Configurar el Handler de Lambda
- En `build/lambdas/enrollment/index.ts`, parsea la clave S3 del evento (`event.Records[0].s3.object.key`).
- Extrae `eventId` y `registrationId`.

### Paso 2: Invocar Rekognition e Idempotencia
- Consulta en DynamoDB si `status == 'ENROLLED'`. Si ya está inscrito, retorna inmediatamente.
- Ejecuta `IndexFacesCommand`. Si `FaceRecords.length === 0`, actualiza a `status = 'FAILED'`.
- Si se detecta un rostro, guarda `faceId` y actualiza a `status = 'ENROLLED'`.

## Errores Comunes a Evitar (Pitfalls)
- ❌ **ERROR**: Volver a indexar un rostro cuando el evento S3 se reintenta.
  - *Solución*: Verifica el estado previo en DynamoDB antes de llamar a Rekognition.
- ❌ **ERROR**: Dejar la Lambda en ciclo infinito de reintentos si no hay rostros.
  - *Solución*: Si no hay rostro, marca la inscripción como `FAILED` de forma limpia sin lanzar una excepción sin capturar.

## Lista de Verificación Pre-PR (Junior Checklist)
- [ ] Una selfie válida indexa y transiciona el estado a `ENROLLED`.
- [ ] Una selfie borrosa o sin cara transiciona a `FAILED` sin fallar la Lambda.
- [ ] Las pruebas de integración con `aws-sdk-client-mock` pasan en verde.
