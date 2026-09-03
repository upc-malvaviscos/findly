# 04 - Administración y Cognito

## Objetivo
Restringir creación de eventos y carga de fotos a organizadores autenticados.

## Requisitos
- Provisionar User Pool, cliente OAuth y autorizador JWT de API Gateway.
- Separar rutas públicas de `POST /events/{eventId}/photos/upload-url` y futuras rutas administrativas.
- Activar MFA opcional, política fuerte de contraseña y trazas sin datos biométricos.

## Aceptación
Una petición sin JWT a ruta administrativa devuelve 401/403; una sesión válida obtiene solo permisos previstos.
