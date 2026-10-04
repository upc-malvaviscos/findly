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

## Métricas de error de registro, subida y polling — 2026-10-04

Implementación según [ADR-018](../adr/ADR-018-client-enrollment-error-telemetry.md)
en la rama `feature/issue-22-enrollment-error-metrics`.

| Criterio                                                 | Prueba                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| Contrato `{ stage, code }` cerrado y normalización       | `tests/shared/enrollmentErrorTelemetry.test.ts`                    |
| Lambda: 204, 400 sin registrar, logs sin identificadores | `tests/lambdas/publicEnrollment.test.ts`                           |
| Cliente: reporte por etapa, tope por sesión, sin PII     | `tests/web/enrollmentMetrics.test.ts`, `tests/web/realApi.test.ts` |
| Metric filters, ruta, rol sin datos y throttling         | `tests/infra/observability.test.ts`                                |
| Rol de demo: `GetMetricData` regional sólo en deploy     | `tests/infra/demo-role-policies.test.ts`                           |
| Comprobación de las cinco series en el smoke             | `tests/infra/enrollmentErrorMetrics.test.ts`                       |
| Fallo de PUT reportado como `upload`/`UPLOAD_HTTP_4XX`   | `e2e/foundation.spec.ts` (backend HTTP simulado, tres navegadores) |
| Métricas en demo desplegada                              | Pendiente: deploy de demo con `scripts/test-demo.mjs` ampliado     |

Validación local del 2026-10-04:

- `npm run lint`, `npm run typecheck` y `npm run test` (352 pruebas en 43
  archivos, con los umbrales de cobertura) pasan.
- `npm run build`, `terraform:format` y `terraform:test:hosting` pasan. Este
  último incluye el plan mock completo de demo, con la ruta y el stage
  enlazados.
- `npm run security` y `npm run sync:check` pasan.
- `npm run test:e2e` pasa: 15 pruebas.
- `terraform validate` pasa en las cinco raíces, con `TF_DATA_DIR` aislado,
  porque el `.terraform` local de sandbox apunta a un backend remoto ajeno.
- `npm run test:e2e:local` (Floci) no se ejecutó porque Docker no estaba
  disponible.

Ninguna de estas pruebas es evidencia de AWS. La issue #22 permanece abierta
hasta ejecutar el deploy de demo con el smoke ampliado. Ese smoke provoca un
registro inválido, un polling con un token ajeno y un reporte por etapa desde el
origen publicado. Después comprueba con `GetMetricData` que `RegistrationErrors`,
`PollingErrors` y `ClientEnrollmentErrors` (registration/upload/polling) tienen
al menos un dato. Tras el smoke se ejecuta la destrucción autorizada de la demo.

## Corrección de aceptación efímera de PR #93 — 2026-10-04

El run [37191895190](https://github.com/upc-malvaviscos/findly/actions/runs/37191895190)
falló en `deployed-observability.mjs`: faltaban logs de una Lambda durante los
12 minutos del probe. El recorrido no invocaba `public-telemetry`, añadida por
ADR-018 y incluida automáticamente en la lista de handlers. Inscripción,
matching, galería, DLQ, alarma y SNS pasaron; la destrucción posterior también.

`deployed-issue-70-acceptance.mjs` incorpora reportes sintéticos de las tres
etapas desde Chromium con CORS nativo y exige 204; un campo adicional exige 400. El probe de observabilidad conserva la exigencia de logs de todos los
handlers y ahora imprime sus nombres pendientes, sin datos de asistentes.
No se amplían tiempos ni se excluye la nueva Lambda. La consulta de las cinco
series permanece en el smoke de demo, independiente del CI efímero.

El run [37195275576](https://github.com/upc-malvaviscos/findly/actions/runs/37195275576)
pasó la aceptación efímera sobre `43bf378`: reportes de las tres etapas (204),
rechazo de campos extra (400), logs de las 13 Lambdas y destrucción de los 111
recursos. PR #93 quedó integrada en `main@1d5eb821`. Esta evidencia no sustituye
la consulta de las cinco series en la demo permanente.

## Seguimiento del ciclo demo tras PR #93

El control de destrucción conservaba sólo cuatro claves del módulo público y
rechazaba la nueva función `telemetry` como `Unexpected indexed resource`.
Se incorpora esa clave sin ampliar direcciones, cuentas, regiones ni actores
permitidos. La regresión en `tests/infra/demo-controls.test.ts` comprueba todos
los handlers declarados en el módulo Terraform y rechaza una clave desconocida.

La revisión administrativa de los roles compara las políticas activas con las
generadas: añade exclusivamente la función/rol de telemetría al inventario y
`cloudwatch:GetMetricData` en deploy, limitado a `eu-west-1`. La demo tenía
estado vacío antes del ciclo. La aceptación de métricas y el borrado posterior
siguen pendientes hasta registrar los nuevos runs AWS.
