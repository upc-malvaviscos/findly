# Issue #22 - Sustitución de mocks web por backend real

Evidencia del cliente web de la [spec 18](../../specs/18-replace-web-mocks-with-real-backend.md). No es evidencia de AWS real: el backend se simula con `page.route` de Playwright siguiendo el contrato de la spec.

| Criterio                                              | Prueba                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| Contrato y errores HTTP                               | `tests/web/realApi.test.ts`                                              |
| XHR: `Content-Type`, progreso, timeout y rechazo      | `tests/web/s3Uploader.test.ts`                                           |
| Polling: éxito, fallo, estado desconocido y límite    | `tests/web/pollRegistrationStatus.test.ts`                               |
| Consentimiento `true` y nada enviado antes de aceptar | `tests/web/enrollment.test.tsx`                                          |
| E2E contra backend HTTP simulado                      | `e2e/foundation.spec.ts` (`npm run test:e2e`)                            |
| Error accionable sin configuración                    | `BACKEND_NOT_CONFIGURED` en `tests/web/realApi.test.ts`                  |
| Smoke contra `demo`                                   | Pendiente: requiere los endpoints de la issue #7 y un entorno desplegado |

Comandos: `npm run typecheck`, `npx vitest run --project web`, `npx playwright test e2e/foundation.spec.ts`.
