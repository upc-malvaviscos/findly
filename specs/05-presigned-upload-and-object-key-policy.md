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
- Configuración CORS restringida al origen exacto del frontend web (`var.frontend_domain_url`) para navegadores. CORS no es un mecanismo de autorización de la URL prefirmada.

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
- [x] La URL prefirmada expira exactamente tras 5 minutos.
      *(Verificado con test unitario en `createPresignedUploadUrl`.)*
- [x] El bucket S3 esta configurado para permitir unicamente `PUT` desde el
      origen exacto del frontend, con cabeceras firmadas restringidas a
      `Content-Type`.
      *(Implementado en `infra/modules/uploads-bucket` y validado con
      `terraform validate`; la verificacion en vivo del rechazo de firma/CORS
      requiere un bucket desplegado, pendiente de la issue #11.)*
- [x] El bucket S3 tiene habilitado el cifrado en reposo SSE-S3.
      *(Implementado en `infra/modules/uploads-bucket`; no aplicado a AWS
      todavia — el modulo no esta conectado a una raiz Terraform real hasta
      que la issue #11 aporte el proveedor y el backend de estado.)*
