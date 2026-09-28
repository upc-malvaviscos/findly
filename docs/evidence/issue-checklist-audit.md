# Auditoría de checklists y niveles de evidencia

Fecha: 2026-09-28. Seguimiento: [#70](https://github.com/upc-malvaviscos/findly/issues/70).
Commit auditado: `a343aa5d3998acff4dda41f1eff671b86f61fc84`.

## Resultado y alcance

Se revisaron las 19 issues cerradas, sus criterios, las specs, los handlers,
Terraform, pruebas, PR fusionadas y checks remotos. No se ejecutó AWS ni se
cambió código de aplicación, IaC, credenciales o permisos.

Una suite verde acredita únicamente los recorridos que ejecuta. Las pruebas
con aws-sdk-client-mock, HTTP interceptado o Floci no acreditan AWS real.

| Issue | Resultado                                          | Evidencia o pendiente                                                                                                                                                                                        |
| ----- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #1    | Cierre respaldado como definición de alcance       | README, paper, ADR-001 a ADR-006 y matriz de métricas. Define objetivos; no acredita alcanzarlos.                                                                                                            |
| #2    | Cierre respaldado como fundación                   | Scripts, TypeScript estricto, hooks y CI vigente.                                                                                                                                                            |
| #3    | Cierre respaldado como contratos                   | Tipos, Zod, claves y tests. No significa que existan todos los endpoints.                                                                                                                                    |
| #4    | Cierre respaldado en el alcance frontend de PR #23 | UI, cámara, consentimiento, progreso y polling simulados; backend delegado expresamente a #22 y publicación a #15. Corregir la casilla que atribuye Playwright a npm run verify.                             |
| #5    | Cierre respaldado                                  | PR #59 y evidencia de sandbox Cognito/admin/401/subida; checks de PR verdes.                                                                                                                                 |
| #6    | Cierre no respaldado por todos sus criterios       | Firma manipulada y CORS real siguen pendientes en #45. Reabrir y conservar la prueba unitaria de 300 s y evidencia SSE-S3.                                                                                   |
| #8    | Cierre no respaldado por todos sus criterios       | Matching unitario demostrado; redrive real pendiente en #46. Reabrir.                                                                                                                                        |
| #9    | Cierre respaldado dentro del alcance de galería    | PR #50: contrato 200/vacía/404/410 y JPEG sintética desplegada; matching real excluido explícitamente.                                                                                                       |
| #10   | Cierre no respaldado por todos sus criterios       | Borrado del handler con mocks probado; DELETE no tiene ruta Terraform, cron no instanciado y lectura posterior pendiente en #47. Reabrir; no marcar el recorrido cliente-AWS como demostrado.                |
| #12   | Checklist respaldado para el stack probado         | PR #48 y check provision-test-destroy: plan sin recursos excluidos y bucket de cargas privado/SSE-S3. Publicación web y dominio/TLS quedan en #15; no extrapolar el smoke a CloudFront o todos los entornos. |
| #13   | Cierre contradice spec, evidencia y PR #64         | Plan offline y logger probados. Sin prueba AWS de alarma/correo/presupuesto ni logs de DELETE; la PR pide no cerrar. Reabrir.                                                                                |
| #14   | Criterios cumplidos; casillas desactualizadas      | CI actual: jobs paralelos, 2 min 40 s total, static-web/coverage/playwright-report y actionlint exitosos. Marcar 3 casillas.                                                                                 |
| #16   | Cierre respaldado dentro del alcance efímero       | Workflow OIDC, estado por PR, concurrencia y destroy; pruebas remotas de PR #48/#50/#55/#57/#59/#60. No incluye todos los módulos del producto.                                                              |
| #17   | Cierre respaldado para cobertura y E2E             | CI actual: 188 tests; líneas Lambdas 98,38 %, shared/lib 100 %; E2E y Floci verdes. No acredita flujos AWS que no estén en el smoke.                                                                         |
| #51   | Cierre respaldado                                  | Épica de modos; #52/#53/#54, PR #55-#57 y spec 19.                                                                                                                                                           |
| #52   | Cierre respaldado                                  | Mocks explícitos de desarrollo, tests de autenticación/admin y límites de activación.                                                                                                                        |
| #53   | Cierre respaldado                                  | E2E Floci y teardown Compose; Cognito local es sintético.                                                                                                                                                    |
| #54   | Cierre respaldado por evidencia histórica          | Sandbox local provisionado, smoke y destrucción registrados en issue y docs, PR #57 verde. No se volvió a desplegar en esta auditoría.                                                                       |

## Evidencia remota comprobada

- [CI de main del 28 de septiembre](https://github.com/upc-malvaviscos/findly/actions/runs/36389598453):
  07:03:36–07:06:16 UTC; frontend, terraform, security-and-sync y e2e exitosos.
  Los cuatro jobs comenzaron a las 07:03:38 UTC.
- Artefactos no caducados: static-web (10956225457), coverage (10956020883)
  y playwright-report (10955473489).
- Frontend: 25 archivos, 188 tests; statements/lines de src/lambdas
  96,98/98,38 %; src/shared/lib 96,77/100 %. Cobertura global de líneas 82,12 %:
  no se presenta como >=90 % global ni como >=90 % de branches.
- [PR #60](https://github.com/upc-malvaviscos/findly/pull/60):
  cliente HTTP/XHR/polling entregado. El smoke AWS de esa PR solo ejercita
  admin/galería, no inscripción pública.
- [PR #64](https://github.com/upc-malvaviscos/findly/pull/64):
  plan offline, logger y configuración de alertas; dice expresamente que no
  hay apply y que no se cierre #13.
- [PR #48](https://github.com/upc-malvaviscos/findly/pull/48),
  [#50](https://github.com/upc-malvaviscos/findly/pull/50),
  [#55](https://github.com/upc-malvaviscos/findly/pull/55),
  [#57](https://github.com/upc-malvaviscos/findly/pull/57) y
  [#59](https://github.com/upc-malvaviscos/findly/pull/59):
  checks de CI, E2E y provision-test-destroy exitosos, contrastados mediante gh.
- El fichero docs/evidence/issue-checklist-audit.md está obsoleto respecto de
  #12; specs 05/07/09 conservan casillas que equiparan configuración con
  verificación en vivo. Spec 03/13 conserva casillas sin sincronizar.

## Estado y reglas de seguimiento

Se reabrieron #6, #8, #10, #13 y #22 y se conservaron sus responsables.
Las issues #4, #12, #14 y #17 siguen cerradas dentro del alcance documentado.
La issue #47 reconoce el GalleryReader existente: falta el recorrido de borrado.

Esta matriz conserva la evidencia histórica. Una entrega posterior debe añadir
commit, PR, run, comandos y entorno, sin reemplazar un test mock por una
suposición de AWS. `npm run verify` no ejecuta Playwright: los comandos E2E son
`npm run test:e2e` y `npm run test:e2e:local`.

El gate de cobertura pendiente se limita a líneas de `src/lambdas` y
`src/shared/lib`; no equivale a cobertura global ni cobertura de ramas.
No se cerrará #70 ni sus dependencias hasta completar sus criterios.
