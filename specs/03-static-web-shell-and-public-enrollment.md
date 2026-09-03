# 03 - Web estática e inscripción pública

## Objetivo
Entregar una experiencia de usuario estática, rápida, accesible e intuitiva en React + Vite servida a través de Amazon CloudFront y Amazon S3 con Origin Access Control (OAC), permitiendo el registro de asistentes y captura/subida de selfies sin servidores Node.js en ejecución.

## Alineación con AWS Well-Architected Framework
- **Seguridad**: CloudFront OAC restringe el bucket S3 como privado; las selfies se suben directamente a S3 mediante URLs `PUT` prefirmadas de 5 min.
- **Eficiencia del Rendimiento**: Sitio 100% estático empaquetado con Vite y distribuido en el Edge vía CDN CloudFront con latencia p95 < 500ms.
- **Optimización de Costes (FinOps)**: Coste de almacenamiento y transferencia $0 en la capa gratuita de AWS.
- **Sostenibilidad**: Cero servidores web o contenedores permanentemente encendidos.

## Requisitos de Arquitectura Frontend

### Configuración Vite & CloudFront OAC
- Utilizar Vite (`vite build`) para generar la aplicación en la carpeta `dist/`.
- Distribución de CloudFront configurada con Origin Access Control (OAC) impidiendo el acceso directo al bucket S3 de la web.
- Redirección automática de HTTP a HTTPS y política de TLS `TLSv1.2_2021`.

### Árbol de Componentes React
- `EnrollmentPage`: Página contenedora principal en `/` o `/enroll`.
- `EventSelector`: Selección de evento disponible o detección automática vía parámetro URL `?event={eventId}`.
- `SelfieCaptureForm`: Formulario principal con gestión de estado de validación Zod.
- `CameraModal`: Componente de modal accesible para captura con cámara web nativa via `navigator.mediaDevices.getUserMedia`.
- `FileDropzone`: Área drag-and-drop con soporte para previsualización instantánea de imagen.
- `ConsentCheckboxGroup`: Casillas de verificación independientes para términos de privacidad y tratamiento de datos biométricos.
- `UploadProgressBar`: Indicador visual con porcentaje de progreso de subida a S3.

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Configurar el Enrutador y Componentes
- En `src/App.tsx`, usa React Router para definir las rutas públicas.
- Crea el formulario `SelfieCaptureForm` importando el validador Zod `enrollmentFormSchema`.

### Paso 2: Crear el Modal de Cámara Web Accesible
- Crea `CameraModal.tsx` activando el stream de vídeo con `navigator.mediaDevices.getUserMedia({ video: true })`.
- Añade listener para cerrar el modal con la tecla `Escape` y limpia el stream (`track.stop()`) al desmontar el componente.

### Paso 3: Implementar la Subida a S3 y Polling
- Invoca la API `POST /events/{eventId}/registrations` para obtener `uploadUrl` y `registrationId`.
- Llama a `uploadFileToS3(uploadUrl, file, onProgress)` con `XMLHttpRequest` para reportar el progreso.
- Tras la subida a S3, inicia polling a `GET /registrations/{id}/status` cada 1.5s (máximo 10 intentos).

## Errores Comunes a Evitar (Pitfalls)
- ❌ **ERROR**: Olvidar detener los tracks de la cámara web al cerrar el modal (`track.stop()`).
  - *Solución*: La luz de la cámara continuará encendida. Siempre limpia los recursos en el `useEffect` o manejador de cierre.
- ❌ **ERROR**: Intentar usar `fetch` para rastrear el porcentaje de subida a S3.
  - *Solución*: `fetch` nativo en navegadores no soporta eventos de progreso de subida. Usa `XMLHttpRequest` (`xhr.upload.onprogress`).

## Lista de Verificación Pre-PR (Junior Checklist)
- [ ] `npm run build` genera la carpeta `dist/` sin advertencias ni errores.
- [ ] El modal de cámara libera el stream de vídeo al cerrarse.
- [ ] La barra de progreso refleja la subida en tiempo real de 0% a 100%.
- [ ] `npm run verify` ejecuta los tests de React Testing Library y Playwright E2E exitosamente.
