# 08 - Galería privada

## Objetivo
Mostrar exclusivamente las fotos coincidentes a través de acceso temporal.

## Requisitos
- Token opaco aleatorio, almacenado como SHA-256, con TTL configurable.
- API valida token y genera URLs GET S3 de cinco minutos; no publicar bucket, ACL ni URL permanente.
- Añadir pantalla `/gallery?token=` con estado vacío, caducado y error.

## Aceptación
Token inválido/caducado devuelve 404 y una URL S3 expirada devuelve denegación de acceso.
