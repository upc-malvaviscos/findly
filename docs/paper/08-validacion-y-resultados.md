# 8. Validación y resultados

Cada afirmación de esta sección enlaza a la evidencia reproducible que la
respalda. Una suite verde sólo acredita los recorridos que ejecuta:
`aws-sdk-client-mock`, HTTP interceptado o Floci nunca acreditan AWS real
(`docs/evidence/issue-checklist-audit.md`).

## Pruebas unitarias y de contrato

Ejecución local sobre `main` (commit `37d0c80`, 2026-09-30, Node 24.17.0):

```text
npm run typecheck   PASS
npm run lint:code   PASS
npm run build       PASS (web + 9 artefactos Lambda .js/.zip)
npm run test        294 tests, 38 archivos; 290 pasan
```

De las 4 pruebas que fallan en este entorno, las cuatro pertenecen a
`tests/infra/deployedObservability.test.ts`: su fixture de CLI escribe un
ejecutable `aws` sin extensión con cabecera `#!`, un patrón POSIX que la
resolución nativa de procesos de Windows no reconoce como ejecutable en
`PATH` (exige `PATHEXT`: `.exe`, `.cmd`, `.bat`…). El proceso hijo localiza en
su lugar el `aws` real instalado en el sistema y falla por falta de región,
no por el fallo controlado que la prueba espera. Es una limitación del arnés
de pruebas específica de Windows, verificada de forma aislada reproduciendo el
mismo patrón de PATH fuera de Vitest; no es una regresión de `main` y no
afecta a la CI real, que se ejecuta en Ubuntu. No se ha corregido en esta
entrega: exige decidir una variante de fixture por plataforma o hacer
`scripts/deployed-observability.mjs` consciente de shell, un cambio a un
script que también corre contra AWS real y queda fuera del alcance de esta
memoria.

Cobertura de líneas de las 290 pruebas restantes (`src/lambdas`,
`src/lambdas/lib`, `src/shared/lib`, `src/web`, excluyendo el proyecto
`infra`):

| Ámbito              | Líneas  | Umbral del gate (`vitest.config.ts`)           |
| ------------------- | ------- | ---------------------------------------------- |
| `src/lambdas`       | 93,78 % | >= 90 %                                        |
| `src/lambdas/lib`   | 100 %   | >= 90 %                                        |
| `src/shared/lib`    | 100 %   | >= 90 %                                        |
| Global del proyecto | 81,34 % | Sin umbral global; no se presenta como >= 90 % |

## Pruebas E2E

Playwright cubre el recorrido mock/HTTP simulado (`npm run test:e2e`) y el
recorrido contra Floci con DynamoDB/S3 emulados (`npm run test:e2e:local`).
La [integración de #70](../evidence/issue-70-integration.md) registra la
última ejecución conjunta: 12 pruebas E2E en Chromium, Firefox y WebKit, y 21
pruebas contra Floci con teardown completo de contenedores, volúmenes y red.
Ninguna de las dos activa Rekognition, Cognito ni IAM reales.

Un tercer nivel, añadido por la PR #72 (issue #7), se ejecuta entre ambos en
el job `e2e` de CI: `npm run test:floci:integration` (14 pruebas) invoca
`selfieIndexer` con eventos S3 construidos en el propio test contra un
contenedor Floci aislado y de un solo uso (proyecto aleatorio, puerto libre).
Cubre persistencia, `GSI1`, duplicados, escrituras condicionales concurrentes,
recuperación de bloqueo y borrado durante el procesamiento — sin pasar por
Playwright ni por un navegador. Tampoco demuestra reconocimiento facial real,
notificaciones S3→Lambda nativas ni IAM; Rekognition sigue simulado.

## Infraestructura como código

Los cinco roots de Terraform (`bootstrap`, `environments/{sandbox,demo,production}`,
`ephemeral`) validan con el proveedor AWS 6.66.0 y Node 24 en las funciones
Lambda (`docs/runbooks/issue-70-aws-review.md`, sección "Upgrade aprobado de
proveedor"). `terraform validate` conserva avisos de deprecación sobre
`hash_key`/`range_key` sin migrar el esquema de DynamoDB. `npm run security`
audita dependencias de producción sin vulnerabilidades.

El backend de estado remoto (ADR-009) se verificó en una cuenta AWS dedicada
en `eu-west-1` el 2026-10-02 (issue #61, sub-issue de #11;
[evidencia](../evidence/issue-11-terraform-remote-state.md)):

- **Bootstrap.** `infra/bootstrap` creó el bucket de estado (6 recursos). Su
  configuración, leída de AWS, confirma versionado, SSE-S3, los cuatro
  bloqueos de acceso público, caducidad de versiones no actuales a 90 días y
  la política TLS-only. Una petición firmada por HTTP recibe `AccessDenied`
  por denegación explícita y por HTTPS funciona.
- **Migración con `moved`.** Se creó un estado `sandbox` real desplegando la
  raíz anterior a ADR-009 (38 recursos con los módulos en la raíz). El `plan`
  de `environments/sandbox` actual contra ese estado mueve los 38 recursos
  bajo `module.findly` sin destruir ni recrear ninguno (`0 to destroy`), y el
  comprobador `check-deployment-plan.mjs` lo acepta. Ese `plan` no se aplicó y
  los recursos de la prueba se destruyeron al terminar.

No se ejecutaron planes reales de `demo` ni `production`.

## Aceptación desplegada en AWS real

La evidencia con mayor peso de esta memoria es el run de aceptación efímera de
[PR #71](https://github.com/upc-malvaviscos/findly/pull/71), ejecutado el
2026-09-28 contra un stack Terraform real por número de PR
(`infra/ephemeral`), con [registro completo del
run](https://github.com/upc-malvaviscos/findly/actions/runs/36482560393) y
`destroy` posterior verificado (103 recursos destruidos, estado remoto vacío).
Demuestra, contra servicios AWS reales y no simulados:

- **Inscripción pública**: navegador real → consentimiento → `PUT` S3
  condicional (`If-None-Match: *`) → indexación Rekognition →
  `FAILED`/`ENROLLED` reales por sondeo.
- **Matching**: similitud sintética >= 95 %; una foto repetida no sobrescribe
  `matchId` (idempotencia); galería privada servida con URLs prefirmadas.
- **Derecho al olvido**: `DELETE` con token ajeno o revocado rechazado;
  borrado del `FaceId` indexado en Rekognition; ausencia posterior de
  `REG`/`MATCH`/`TOKEN`/selfie; galería devuelve `404` tras el borrado.
- **Firmas y CORS**: firmas de método, clave o `Content-Type` manipuladas
  rechazadas; preflight CORS nativo (sin interceptación de red); SSE-S3 en el
  bucket de cargas.
- **Resiliencia de colas**: un mensaje venenoso original llegó a la DLQ tras
  tres recepciones fallidas (`maxReceiveCount = 3`); la alarma real se activó
  y la notificación SNS → SQS se recibió y procesó.
- **Observabilidad**: doce grupos de logs con retención de 14 días; líneas
  JSON con `correlationId`; comprobación automática de ausencia de campos
  sensibles en los mensajes capturados.

**Lo que este run no acredita**, textualmente, según su propio cierre: el
aviso real de AWS Budgets, un correo de alerta confirmado, el disparo del
`EventBridge Scheduler` real (la purga se invocó manualmente, no por cron), ni
una SPA de demostración publicada. El detalle de permisos IAM aprobados para
el rol de CI efímero, incluidas las tres ampliaciones puntuales necesarias
para completar este run, está en `docs/runbooks/issue-70-aws-review.md`.

## Seguridad y gobierno de datos

`docs/evidence/issue-70-verification-gates.md` registra la corrección del
presigner S3 (firma explícita de `content-type` con el SDK real, sin mock de
`getSignedUrl`) y el gate de cobertura por ámbito. Los ADR-013/014/015
(capítulos 4 y 6) están verificados dentro del mismo run de aceptación:
localizador de limpieza sin TTL, PUT condicional de una sola escritura para
selfies y aislamiento de colecciones Rekognition por entorno.

## Estado de FinOps y observabilidad (issue #13)

El módulo `monitoring` (topic SNS, presupuesto al 80 % de gasto real,
alarma de la DLQ) está verificado con un `terraform plan` sin conexión a AWS
y con pruebas automatizadas (`docs/evidence/issue-13-observability-finops.md`).
La alarma DLQ y la entrega SNS → SQS sí están verificadas en AWS real (sección
anterior); el aviso de Budgets y la confirmación de un correo de alerta no lo
están. Esta issue permanece abierta por ese motivo.

## Matriz de trazabilidad spec ↔ issue ↔ evidencia

Cada fila enlaza una spec con la issue que la implementó y el fichero de
evidencia reproducible que lo demuestra — la regla de `AGENTS.md` de que
ninguna de las tres piezas se cierra sin sincronizar las otras dos, aplicada
como tabla. Se omiten las specs sin evidencia dedicada propia (00, 01, 13, 16, 19) porque su verificación vive en la CI general (capítulo 5), no en un
fichero de `docs/evidence/` individual.

| Spec | Issue | Evidencia                                                                                             | Estado                                         |
| ---- | ----- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 02   | #3    | `issue-03-domain-contracts.md`                                                                        | Cerrada                                        |
| 03   | #4    | `issue-04-frontend-auth.md`                                                                           | Cerrada (backend real en #22)                  |
| 04   | #5    | `issue-05-admin-cognito.md`, `issue-05-09-platform-foundation.md`                                     | Cerrada                                        |
| 05   | #6    | `issue-06-presigned-uploads.md`; verificación de firma/CORS (#45) en `issue-70-verification-gates.md` | Cerrada 28-sep tras PR #71                     |
| 06   | #7    | —                                                                                                     | Abierta                                        |
| 07   | #8    | `issue-08-photo-matching.md`; verificación de DLQ (#46) en `issue-70-verification-gates.md`           | Cerrada 28-sep tras PR #71                     |
| 08   | #9    | `issue-09-private-gallery.md`                                                                         | Cerrada                                        |
| 09   | #10   | `issue-10-consent-erasure.md`, `issue-70-erasure-retention.md`                                        | Abierta (cron real pendiente)                  |
| 10   | #11   | `issue-11-terraform-remote-state.md`                                                                  | Abierta; #61 verificada en AWS, cierre tras PR |
| 11   | #12   | `issue-12-secure-serverless-infra.md`                                                                 | Cerrada                                        |
| 12   | #13   | `issue-13-observability-finops.md`                                                                    | Abierta (Budgets/correo reales pendientes)     |
| 14   | #15   | —                                                                                                     | Abierta                                        |
| 15   | #16   | `issue-16-ephemeral-pr-ci.md`                                                                         | Cerrada                                        |
| 17   | #18   | `issue-18-paper-runbook.md`                                                                           | Abierta (esta memoria)                         |
| 18   | #22   | `issue-22-web-real-backend.md`, `issue-70-public-enrollment.md`                                       | Abierta                                        |
| —    | #49   | `issue-49-dynamodb-vs-rds-analysis.md`                                                                | Abierta (análisis, sin decisión)               |
| —    | #70   | `issue-70-*.md` (5 ficheros), `issue-checklist-audit.md`                                              | Abierta (coordina fase 3)                      |

La [matriz de auditoría de #70](../evidence/issue-checklist-audit.md)
distingue, issue por issue, qué criterios están respaldados por evidencia
desplegada y cuáles siguen dependiendo de una suite mock o Floci. Las issues
`#10`, `#13`, `#15` y `#18` permanecen abiertas por criterios de evidencia
desplegada pendientes; el capítulo 9 detalla cada limitación. `#11` y su
sub-issue `#61` tienen ya sus criterios verificados en AWS y se cierran al
integrarse la evidencia.
