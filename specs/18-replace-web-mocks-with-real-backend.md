# 18 - Sustitución de mocks web por backend real

## Objetivo

Sustituir el adaptador mock del flujo público de inscripción de la issue #4 por llamadas al backend serverless real, manteniendo la UI React + Vite y sus contratos tipados sin acoplarla a AWS.

Esta tarea no rediseña la experiencia de usuario ni introduce un servidor Node.js persistente. El navegador deberá hablar con API Gateway para obtener instrucciones de subida, subir la imagen directamente a S3 y consultar el estado de la inscripción.

## Dependencias

- Issue #4: Web estática e inscripción pública.
- Issue #3: contratos de dominio, DTOs y claves DynamoDB.
- Issue #6: URLs prefirmadas y política de claves S3.
- Issue #7: Lambda de inscripción facial y estados de procesamiento.
- Issue #10: consentimiento, retención y derecho al olvido.

La implementación no podrá darse por completada hasta que los contratos de las issues dependientes estén publicados y exista un entorno `demo` verificable.

## Contrato de integración

El cliente conservará una interfaz equivalente a la del mock:

```ts
getEvent(eventId: string): Promise<Event | null>
createRegistration(request: RegistrationRequest): Promise<RegistrationResponse>
uploadFileToS3(uploadUrl: string, file: File, onProgress: (progress: UploadProgress) => void): Promise<void>
getRegistrationStatus(registrationId: string): Promise<RegistrationStatusResponse>
```

Las implementaciones reales usarán los siguientes endpoints:

- `GET /events/{eventId}` o el endpoint de descubrimiento acordado en la issue #3.
- `POST /events/{eventId}/registrations` para validar consentimiento y crear la inscripción.
- `PUT {uploadUrl}` para subir el binario directamente a S3, enviando exactamente el `Content-Type` firmado.
- `GET /registrations/{registrationId}/status` para consultar el estado.

Los errores seguirán el formato `{ code, message, requestId }`. El frontend no mostrará tokens, claves S3, datos biométricos ni detalles internos.

## Requisitos de implementación

1. Reemplazar el adaptador mock mediante configuración explícita de runtime, sin cambiar los componentes de presentación.
2. Configurar el origen de API mediante una variable pública de build; no incluir credenciales AWS en el bundle.
3. Implementar la subida con `XMLHttpRequest` para conservar progreso, cancelación y manejo de errores HTTP.
4. Mantener el polling limitado a 10 intentos cada 1,5 segundos y detenerlo en `ENROLLED` o `FAILED`.
5. Tratar como errores recuperables los fallos de red, URLs expiradas, respuestas no JSON y estados desconocidos.
6. No guardar nombres, emails, tokens ni imágenes en `localStorage`, logs del navegador o parámetros URL.
7. Mantener el consentimiento explícito antes de llamar al endpoint de registro y mostrar la política de retención de 30 días definida para el MVP.

## Seguridad y operación

- API Gateway deberá aceptar únicamente el origen frontend del entorno correspondiente.
- S3 deberá permanecer privado y aceptar la subida solo mediante la URL prefirmada.
- La URL prefirmada tendrá una expiración máxima de 300 segundos y una clave determinista por inscripción.
- CloudFront deberá servir la SPA mediante HTTPS con OAC hacia el bucket web.
- Los logs de cliente y backend usarán `requestId`/`correlationId` sin PII.
- Las métricas de error de registro, subida y polling deberán quedar disponibles para la validación del entorno demo.

## Compatibilidad y despliegue

- El mock seguirá disponible para desarrollo local y tests unitarios.
- El entorno `demo` activará el adaptador real mediante variables de build.
- La aplicación deberá mostrar un error accionable si falta la configuración del backend.
- La sustitución no debe requerir cambios en los componentes `SelfieCaptureForm`, `CameraModal` o `FileDropzone` salvo ajustes de contrato estrictamente justificados.

## Pruebas y aceptación

- Tests de contrato para respuestas correctas y errores HTTP del backend.
- Test de `XMLHttpRequest` que compruebe `Content-Type`, progreso, timeout y rechazo de la subida.
- Tests de polling para éxito, fallo, estado desconocido y límite de intentos.
- Test que confirme que el consentimiento se envía como `true` y que no se envía ningún dato antes de aceptarlo.
- E2E contra un backend mock HTTP compatible con el contrato real.
- Smoke E2E contra el entorno `demo`, sin usar imágenes o datos personales reales.
- `npm run verify` y la validación de infraestructura deberán pasar antes de mergear.

## Fuera de alcance

- Implementación de Cognito o administración de eventos.
- Galería privada y envío de emails.
- Integración directa del SDK de AWS en el navegador.
- Cambios en el algoritmo de Rekognition o en el modelo de matching.
