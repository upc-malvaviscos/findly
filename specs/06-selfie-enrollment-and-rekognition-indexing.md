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
- **Variables de Entorno**: `FINDLY_TABLE_NAME`, `FINDLY_COLLECTION_NAMESPACE`.

### Flujo de Eventos S3 -> Lambda -> Rekognition

1. La subida finalizada del archivo selfie a S3 (`events/{eventId}/selfies/{registrationId}.selfie.jpg`) dispara un evento `ObjectCreated:Put` a la Lambda de inscripción facial.
2. La Lambda ejecuta `IndexFacesCommand` de AWS Rekognition sobre `${project}-${environment}-event-${eventId}` con `ExternalImageId = registrationId`, `MaxFaces = 1`, `QualityFilter = "AUTO"`.
3. Transiciones en DynamoDB: `UPLOAD_PENDING` -> `PROCESSING` -> `ENROLLED` (éxito) / `FAILED` (error o sin cara).

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Configurar el Handler de Lambda

- En `src/lambdas/selfieIndexer.ts`, parsea la clave S3 del evento (`event.Records[0].s3.object.key`).
- Extrae `eventId` y `registrationId`.

### Paso 2: Invocar Rekognition e Idempotencia

- Consulta en DynamoDB si `status == 'ENROLLED'`. Si ya está inscrito, retorna inmediatamente.
- Ejecuta `IndexFacesCommand`. Si `FaceRecords.length === 0`, actualiza a `status = 'FAILED'`.
- Si se detecta un rostro, guarda `faceId` y actualiza a `status = 'ENROLLED'`.

## Errores Comunes a Evitar (Pitfalls)

- ❌ **ERROR**: Volver a indexar un rostro cuando el evento S3 se reintenta.
  - _Solución_: Verifica el estado previo en DynamoDB antes de llamar a Rekognition.
- ❌ **ERROR**: Dejar la Lambda en ciclo infinito de reintentos si no hay rostros.
  - _Solución_: Si no hay rostro, marca la inscripción como `FAILED` de forma limpia sin lanzar una excepción sin capturar.

## Lista de Verificación Pre-PR (Junior Checklist)

- [x] Una selfie sintética válida indexa en Rekognition AWS y transiciona a
      `ENROLLED` (PR #72, run 36761432962).
- [x] Una imagen sin cara transiciona a `FAILED` sin fallar el recorrido AWS
      (PR #72, run 36761432962). La variante borrosa no se probó por separado.
- [x] Las pruebas unitarias con `aws-sdk-client-mock` verifican estados,
      idempotencia y carreras de borrado. No acreditan AWS.

## Entrega #70

Los handlers públicos y SelfieIndexer están implementados; el único recurso
S3 notification del módulo photo-matching usa los sufijos de ADR-012. La
colección se crea idempotentemente y con etiquetas por entorno. El smoke
efímero de PR #72 ejercitó el fixture adulto ficticio en AWS, verificó
`FAILED`/`ENROLLED` y destruyó los recursos del PR.

## Recuperación y aislamiento aprobados (issue #70)

ADR-013 mantiene un locator RETENTION sin TTL y los FaceIds conocidos;
ListFaces paginado por ExternalImageId permite recuperar una indexación cuya
persistencia quedó interrumpida. Antes de publicar ENROLLED se registran los
candidatos y se comprueba que no haya comenzado el borrado. Los eventos tardíos
reconcilian la limpieza sin reactivar la inscripción.

ADR-014 exige PUT firmado con `If-None-Match: *`. ADR-015 exige el namespace
por entorno para indexer, matcher y limpieza; no permite fallback legacy en
AWS. El parser admite claves antiguas, pero las notificaciones nuevas usan
los sufijos de ADR-012. Terraform limita la edad del evento asíncrono a 21600
segundos y dos reintentos. Estas garantías tienen pruebas locales. La
aceptación AWS de PR #72 acreditó el recorrido de inscripción, pero no
ejercitó todas las carreras de borrado y recuperación por separado.

## Alineación de la rama issue #7

La rama adopta sin cambios los handlers, contratos e infraestructura de main
(e7da348). Añade integración aislada DynamoDB/S3 en Floci con Rekognition
simulado para verificar inscripción pública, indexación y polling. Véase
[la evidencia](../docs/evidence/issue-07-main-alignment.md).
Las pruebas Floci no acreditan entrega automática de eventos ni reconocimiento
AWS; el smoke posterior de PR #72 sí observó ambos. El fallo de visibilidad
transitoria de `SearchFaces` se diagnosticó con CloudTrail, corrigió con
reintento acotado y validó en AWS. Véase
[el cierre de evidencia](../docs/evidence/issue-07-ci-merge-readiness.md).
