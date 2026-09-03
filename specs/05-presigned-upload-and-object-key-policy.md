# 05 - Cargas prefirmadas y políticas de claves en S3

## Objetivo
Permitir la transferencia segura de imágenes directamente desde el navegador a buckets S3 privados mediante URLs `PUT` prefirmadas, sin exponer credenciales ni permisos de AWS al cliente web.

## Requisitos de Seguridad y Políticas de S3

### Configuración del Bucket S3
- Bucket 100% privado con bloqueo de acceso público (`Block Public Access` activado).
- Cifrado en reposo obligatorio con SSE-S3 (`AES256`).
- Configuración CORS restringida estrictamente al origen del dominio del frontend web.

### Reglas de URLs Prefirmadas (Backend Lambda)
- Método HTTP permitido: Únicamente `PUT`.
- Tiempo de expiración: Estrictamente 300 segundos (5 minutos).
- Restricción de tipo MIME: Solo `image/jpeg` o `image/png`.
- Estructura determinista de claves de objeto S3:
  - Selfies: `events/{eventId}/selfies/{registrationId}.jpg`
  - Fotos de evento: `events/{eventId}/photos/{photoId}.jpg`

## Especificación de Integración Frontend (Cliente HTTP)

### Implementación del Helper de Subida con Progreso (`uploadFileToS3`)
```typescript
export async function uploadFileToS3(
  presignedUrl: string,
  file: File,
  onProgress?: (percentage: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presignedUrl, true);
    xhr.setRequestHeader('Content-Type', file.type);

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`La subida a S3 falló con estado HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Error de red durante la transferencia a S3'));
    xhr.send(file);
  });
}
```

### Manejo de Errores en Frontend
- Intentar subir un archivo con URL caducada (> 5 min) debe capturar el error 403 Forbidden y solicitar una nueva URL prefirmada.
- Errores de discrepancia en Content-Type o tamaño son mostrados inmediatamente al usuario.

## Criterios de Aceptación
- Un intento de subida con URL caducada, tipo MIME distinto al especificado u origen de dominio no autorizado es rechazado por S3.
- Las imágenes subidas quedan almacenadas con la clave determinista esperada y con cifrado SSE-S3.
