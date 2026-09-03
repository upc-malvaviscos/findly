# 09 - Consentimiento y borrado

## Objetivo
Aplicar minimización y retirada de datos biométricos.

## Requisitos
- Registrar versión de texto, fecha, propósito y estado de consentimiento.
- Aplicar lifecycle S3 y TTL DynamoDB; Lambda de retención elimina FaceIds de Rekognition.
- Crear operación administrativa de borrado que elimina selfie, FaceId, coincidencias, token y marca auditoría.

## Aceptación
Una prueba de retirada muestra que no quedan objetos, FaceId ni enlaces utilizables para el registro objetivo.
