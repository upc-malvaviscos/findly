# Issue #22 - Sustitución de mocks web por backend real

Evidencia del cliente web de la [spec 18](../../specs/18-replace-web-mocks-with-real-backend.md). No es evidencia de AWS real: el backend se simula con `page.route` de Playwright siguiendo el contrato de la spec.

| Criterio                                              | Prueba                                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Contrato y errores HTTP                               | `tests/web/realApi.test.ts`                                                                               |
| XHR: `Content-Type`, progreso, timeout y rechazo      | `tests/web/s3Uploader.test.ts`                                                                            |
| Polling: éxito, fallo, estado desconocido y límite    | `tests/web/pollRegistrationStatus.test.ts`                                                                |
| Consentimiento `true` y nada enviado antes de aceptar | `tests/web/enrollment.test.tsx`                                                                           |
| E2E contra backend HTTP simulado                      | `e2e/foundation.spec.ts` (`npm run test:e2e`)                                                             |
| Error accionable sin configuración                    | `BACKEND_NOT_CONFIGURED` en `tests/web/realApi.test.ts`                                                   |
| Smoke contra `demo`                                   | Run 37151100042, intento 3: SPA publicada, inscripción pública, PUT S3/CORS, indexación y matching reales |

Comandos: `npm run typecheck`, `npx vitest run --project web`, `npx playwright test e2e/foundation.spec.ts`.

## Aceptación AWS real de demo — 2026-10-03

El [run 37151100042, intento 3](https://github.com/upc-malvaviscos/findly/actions/runs/37151100042)
ejecutó `scripts/test-demo.mjs` contra la SPA HTTPS/OAC publicada. Verificó
Cognito, creación de evento, inscripción pública y PUT S3 con CORS nativo,
indexación facial, subida por administrador, matching y carga de la imagen de
galería privada. Sin interceptar respuestas ni usar datos personales reales.
El detalle del ciclo permanente se registra en
[evidencia de issue #15](issue-15-permanent-demo.md).

La issue #22 permanece abierta por su criterio de métricas: RegistrationErrors
y PollingErrors existen en CloudWatch; los contadores de cliente de las tres
etapas son sólo de sesión y no acreditan la exposición operativa completa.
