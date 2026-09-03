# 05 - Cargas prefirmadas y políticas de claves en S3

## Objetivo
Permitir la transferencia segura de imágenes directamente desde el navegador a buckets S3 privados mediante URLs `PUT` prefirmadas, sin exponer credenciales ni permisos de AWS al cliente web.

## Alineación con AWS Well-Architected Framework
- **Seguridad**: Bloqueo de acceso público S3 (`Block Public Access`), cifrado SSE-S3 (`AES256`), firma SigV4 y tiempo de expiración corto (5 min).
- **Eficiencia del Rendimiento**: Transferencia directa navegador -> S3 sin pasar por servidores o Lambdas intermediary para el payload binario.

## Especificación Técnica de S3 y Lambda

### Configuración del Bucket S3
- Bucket 100% privado con bloqueo de acceso público activado.
- Cifrado en reposo obligatorio con SSE-S3 (`AES256`).
- Configuración CORS restringida al dominio del frontend web (`var.frontend_domain_url`).

### Reglas de URLs Prefirmadas (Lambda `PresignedUrlGenerator`)
- Configuración Lambda: `memory_size = 256`, `timeout = 3`.
- Método HTTP permitido: Únicamente `PUT`.
- Expiración: Estrictamente 300 segundos (5 minutos).
- Claves deterministas:
  - Selfies: `events/{eventId}/selfies/{registrationId}.jpg`
  - Fotos de evento: `events/{eventId}/photos/{photoId}.jpg`

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Implementar el Generador de URLs en Lambda
- Usa `@aws-sdk/s3-request-presigner` y `PutObjectCommand` en Node.js 24.
- Configura `expiresIn: 300` y pasa el `ContentType` de la imagen.

### Paso 2: Crear el Helper Frontend (`uploadFileToS3`)
- En `src/lib/s3Uploader.ts`, escribe la función que usa `XMLHttpRequest` para emitir el evento `xhr.upload.onprogress`.

## Errores Comunes a Evitar (Pitfalls)
- ❌ **ERROR**: Discrepancia entre el `Content-Type` firmado por Lambda y el encabezado `Content-Type` enviado en el `PUT` de S3.
  - *Solución*: Deben ser **idénticos** (ej. `image/jpeg`). De lo contrario, S3 devolverá un error de firma 403 Forbidden.
- ❌ **ERROR**: Exponer permisos `s3:GetObject` públicos en el bucket.
  - *Solución*: El bucket debe permanecer estrictamente privado.

## Lista de Verificación Pre-PR (Junior Checklist)
- [ ] La URL prefirmada expira exactamente tras 5 minutos.
- [ ] Intentar subir un archivo con un dominio o método diferente a `PUT` devuelve error 403.
- [ ] El bucket S3 tiene habilitado el cifrado en reposo SSE-S3.
