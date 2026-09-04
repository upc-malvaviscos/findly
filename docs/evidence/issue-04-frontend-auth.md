# Evidencia de autenticación frontend

Implementación de la spec 04 en la SPA React + Vite.

## Alcance verificado

- `/admin/events` muestra login cuando no existe una sesión.
- El login crea una sesión en memoria y permite acceder al área de organizadores.
- El cierre de sesión elimina la sesión y devuelve a login.
- Los tokens no se guardan en `localStorage`.
- `apiClient` adjunta `Authorization: Bearer` y convierte `401` en error de sesión.
- `BulkPhotoUploader` limita la cola a tres cargas simultáneas y muestra progreso individual/global.

## Validación

```text
npm run typecheck       PASS
npm test                PASS (8 tests)
npm run lint:code       PASS
npm run build:web       PASS
npm run test:e2e        PENDING: ejecutar con WebKit instalado en el entorno CI/demo
```

La integración con el User Pool de Cognito y el autorizador JWT de API Gateway pertenece a la provisión de infraestructura y queda pendiente de su contrato/configuración.
