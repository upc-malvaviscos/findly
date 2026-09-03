# 03 - Web estática e inscripción pública

## Objetivo
Entregar una experiencia de usuario estática, rápida, accesible e intuitiva en Next.js (`output: export`) servida a través de Amazon CloudFront y Amazon S3 con Origin Access Control (OAC), permitiendo el registro de asistentes y captura/subida de selfies sin servidores Node.js en ejecución.

## Requisitos de Arquitectura Frontend y AWS CDN

### Configuración Next.js & CloudFront OAC
- Utilizar `output: export` en `next.config.mjs` para generación de sitio web 100% estático.
- Distribución de CloudFront configurada con Origin Access Control (OAC) impidiendo el acceso directo al bucket S3 de la web.
- Redirección automática de HTTP a HTTPS y política de TLS `TLSv1.2_2021`.

### Árbol de Componentes React
- `EnrollmentPage`: Página contenedora principal en `/` o `/enroll`.
- `EventSelector`: Selección de evento disponible o detección automática vía parámetro URL `?event={eventId}`.
- `SelfieCaptureForm`: Formulario principal con gestión de estado de validación.
- `CameraModal`: Componente de modal accesible para captura con cámara web nativa via `navigator.mediaDevices.getUserMedia`.
- `FileDropzone`: Área drag-and-drop con soporte para previsualización instantánea de imagen.
- `ConsentCheckboxGroup`: Casillas de verificación independientes para términos de privacidad y tratamiento de datos biométricos.
- `UploadProgressBar`: Indicador visual con porcentaje de progreso de subida a S3.

### Máquina de Estados de la Interfaz (UI State Machine)
- `IDLE`: Esperando que el usuario cargue o capture una foto y complete el formulario.
- `VALIDATING`: Comprobación local de restricciones (tamaño <= 10 MB, tipo `image/jpeg` / `image/png`).
- `REQUESTING_URL`: Llamada HTTP `POST /events/{eventId}/registrations` a API Gateway para obtener `registrationId` y `uploadUrl`.
- `UPLOADING_S3`: Petición `PUT` directa con binario a la URL prefirmada de S3 con listener de progreso `onprogress`.
- `POLLING_INDEX`: Consultas periódicas a `GET /registrations/{id}/status` (cada 1.5s, máx 10 reintentos) hasta estado `ENROLLED`.
- `SUCCESS`: Muestra el código de inscripción, confirmación de guardado y botón para guardar/copiar el enlace de la futura galería.
- `ERROR`: Estado de fallo con feedback claro (ej. "No se detectó un rostro en la foto", "El archivo supera 10 MB", "Error de red").

### Validación Zod en Cliente
```typescript
import { z } from 'zod';

export const enrollmentFormSchema = z.object({
  eventId: z.string().min(1, 'Selecciona un evento válido'),
  email: z.string().email('Introduce un correo electrónico válido').optional().or(z.literal('')),
  consentBiometrics: z.literal(true, {
    errorMap: () => ({ message: 'Debes aceptar el tratamiento de datos biométricos' }),
  }),
  consentTerms: z.literal(true, {
    errorMap: () => ({ message: 'Debes aceptar las condiciones y plazo de retención' }),
  }),
  photo: z
    .custom<File>((val) => val instanceof File, 'Se requiere una imagen')
    .refine((file) => file.size <= 10 * 1024 * 1024, 'La imagen no debe superar los 10 MB')
    .refine(
      (file) => ['image/jpeg', 'image/png'].includes(file.type),
      'Formato de imagen no soportado. Debe ser JPG o PNG'
    ),
});
```

### Accesibilidad (a11y) y UX
- Etiquetas ARIA (`aria-live="polite"`, `aria-describedby`) en mensajes de validación y progreso.
- Trampa de foco (`focus trap`) activa en el modal de cámara web y atajo de teclado `Escape` para cerrar.
- Soporte completo para navegación por teclado (`Tab`, `Space`, `Enter`).

## Criterios de Aceptación
- La compilación `npm run build` genera un sitio estático correcto en `out/`.
- Pruebas E2E en Playwright verifican: formulario semántico, validación de 10 MB, consentimiento requerido y simulación de subida exitosa.
- Cero almacenamiento de claves AWS o código privilegiado dentro del paquete JavaScript cliente.
