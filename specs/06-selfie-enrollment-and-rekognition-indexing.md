# 06 - Inscripción facial

## Objetivo
Indexar una selfie autorizada y reflejar estado determinista.

## Requisitos
- S3 activa Lambda; Rekognition `IndexFaces` usa `ExternalImageId=registrationId`.
- Transiciones: `UPLOAD_PENDING → PROCESSING → ENROLLED|FAILED`.
- Persistir FaceId solo tras éxito, registrar fallo seguro y no repetir indexaciones por eventos duplicados.

## Aceptación
Pruebas de evento S3 cubren cara válida, sin cara, error AWS y reintento idempotente.
