# 05 - Cargas prefirmadas y claves S3

## Objetivo
Transferir imágenes sin exponer permisos S3 a navegadores.

## Requisitos
- Generar URL PUT de cinco minutos, tipo MIME restringido y claves deterministas por evento/entidad.
- Mantener buckets privados, cifrado SSE-S3, CORS por origen exacto y bloqueo de acceso público.
- Rechazar rutas, tamaño o metadatos inconsistentes; registrar identificador de correlación.

## Aceptación
Una URL caducada, MIME no permitido u origen distinto no puede cargar ni leer objetos.
