# Evidencia de observabilidad y FinOps

Implementación de la spec 12 ([issue #13](https://github.com/upc-malvaviscos/findly/issues/13)):
logs estructurados con `correlationId` sin datos personales, alerta de la DLQ de
fotos hacia SNS y un presupuesto de AWS Budgets que avisa al 80 %.

La PR #64 documentada en este archivo sólo ejecutó `terraform plan` offline y
pruebas automatizadas. Después, la [PR #71](https://github.com/upc-malvaviscos/findly/pull/71)
desplegó un stack efímero: el
[run 36482560393](https://github.com/upc-malvaviscos/findly/actions/runs/36482560393)
comprobó 12 grupos de logs con retención de 14 días, JSON con `correlationId`
sin campos sensibles, redrive real a DLQ, estado ALARM y recepción SNS → SQS.
El stack se destruyó. Budgets no se creó allí (`enable_budget=false`), y no se
confirmó correo ni se observó un aviso de AWS Budgets.

## Alcance verificado

- `src/lambdas/lib/logger.ts`: una línea JSON por evento con una lista cerrada
  de campos (`eventId`, `photoId`, `statusCode`, `durationMs`, `errorName` y
  contadores). No hay campo para nombres, correos, tokens, `faceId`,
  `registrationId` ni mensajes de error; una clave fuera de la lista se descarta
  en ejecución y un texto que no parece un identificador se sustituye por
  `[redacted]`. El `correlationId` es el `requestId` de API Gateway, el
  `awsRequestId` de Lambda o el `messageId` de SQS.
- Los cinco handlers (`gallery`, `deleteRegistration`, `adminEvents`,
  `photoMatcher`, `retentionPurger`) usan el logger. Los HTTP devuelven el
  `correlationId` como `requestId` del error, de modo que un reporte de soporte
  se localiza en los logs.
- `photoMatcher` capturaba todo fallo sin registrarlo: una alarma de DLQ no
  tenía nada que diagnosticar. Ahora registra cada mensaje fallido (sólo el
  nombre de la clase de error) y un resumen del lote.
- `infra/modules/monitoring/`: topic SNS `findly-{env}-alerts` con política
  restringida (sólo CloudWatch Alarms y Budgets de la misma cuenta; se
  deniega el tráfico sin TLS), suscripción de correo opcional (`alert_email`, sensible, `null` por
  defecto) y `aws_budgets_budget.finops` al 80 % del gasto real.
- `infra/modules/findly-stack` instancia `photo-matching` y `monitoring` (lo heredan
  los roots `sandbox`, `demo` y `production`; `infra/ephemeral` no usa el stack);
  la alarma de la DLQ
  pasa a notificar al topic. Los recursos de `photo-matching` ganan el sufijo de
  entorno de la spec 10.
- `tests/infra/observability.test.ts`: guarda estática en CI de los tres
  criterios de la spec.

## Criterios de la spec 12 en la fase offline de PR #64

| Criterio                                | Prueba                                                                                                                                                            | Estado                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Log groups con `retention_in_days = 14` | Plan offline: 5 grupos, todos 14; `tests/infra/observability.test.ts` (también exige un grupo por módulo con Lambda)                                              | Demostrado en plan; `deleteRegistration` sin TF |
| Alarma SQS DLQ vinculada al tema SNS    | Plan offline (`dlq_alarm_actions` → `module.monitoring.alerts_topic_arn`); prueba estática                                                                        | Demostrado en plan, sin apply                   |
| AWS Budgets avisa al 80 %               | Plan offline (`GREATER_THAN` 80 `PERCENTAGE` `ACTUAL`, 5 USD, `subscriber_sns_topic_arns`); prueba estática                                                       | Demostrado en plan, sin apply                   |
| Logs JSON con `correlationId`, sin PII  | `tests/lambdas/lib/logger.test.ts` y bloques `structured logging` de cada handler: ausencia de token, nombre, `registrationId`, `faceId`, URL y mensajes de error | Demostrado con pruebas unitarias                |

## Plan de Terraform sin AWS

`terraform plan` de cada root de entorno sobre una copia de `infra/` con
credenciales falsas, artefactos vacíos, estado local y
`skip_credentials_validation` (ver [Reproducción](#reproducción)). Resumen del
JSON de los tres planes:

```text
                 sandbox        demo           production
recursos         52             51             51
log groups       5 (14 días)    5 (14 días)    5 (14 días)
alarma DLQ       findly-{env}-photos-dlq-has-messages, >= 1, alarm_actions <- monitoring
presupuesto      sí (5 USD,     no             no
                 80 % ACTUAL)
topic SNS        findly-{env}-alerts, suscripción de correo con endpoint sensible
tipos de coste fijo (vpc, nat, ec2, rds, lb, eks): 0 en los tres
nombres          findly-{env}-photos-queue, -photos-dlq, -photo-matcher
```

El presupuesto usa `cost_types` con `include_credit = false` e
`include_refund = false`. Sin `alert_email`, el plan de `sandbox` crea 51
recursos (0 suscripciones, 1 presupuesto, 1 topic, 1 alarma). El correo no
aparece en el texto del plan (`(sensitive value)`) y `alert_email=not-an-email`
se rechaza con un mensaje claro.

## Muestra de logs

Líneas generadas por el propio logger con identificadores sintéticos (formato
que CloudWatch Logs Insights descubre como campos JSON):

```json
{"level":"INFO","event":"registration_erased","correlationId":"apigw-req-1","eventId":"evt-1","matchesDeleted":2,"faceDeleted":true}
{"level":"INFO","event":"delete_registration_request","correlationId":"apigw-req-1","eventId":"evt-1","statusCode":204,"durationMs":41}
{"level":"WARN","event":"gallery_request","correlationId":"apigw-req-2","statusCode":404,"durationMs":9}
{"level":"ERROR","event":"photo_matching_failed","correlationId":"c1f0d1a2-6b7e-4c0a-9d51-0f2b3a4c5d6e","eventId":"demo-2026","photoId":"photo-fail","errorName":"AccessDeniedException"}
```

`registration_erased` ya no incluye `registrationId`: el identificador de quien
pidió ser olvidado permanecería 14 días en CloudWatch Logs.

## Reproducción

```sh
npm run test -- --project lambdas --project infra
npm run terraform:validate
npm run lint:terraform
```

El plan offline se ejecutó en una copia temporal, no en el repositorio: se
copiaron `infra/environments` e `infra/modules`, se eliminó `backend "s3" {}` de
cada root, se añadió un `override.tf` con `skip_credentials_validation`,
`skip_requesting_account_id`, `skip_metadata_api_check` y claves ficticias, y se
crearon `artifacts/lambdas/{adminEvents,gallery,photoMatcher}.zip` vacíos junto a
la copia. Después,
`terraform -chdir=infra/environments/<entorno> plan -var alert_email=<correo>`
(el `terraform.tfvars` del entorno se carga solo) y `terraform show -json`.

## Validación

```text
npm run harness:check                 PASS
npm run verify                        PASS (completo; desglose a continuación)
  lint:code, lint:format, lint:markdown             PASS
  lint:terraform (tflint 0.64, 5 roots)             PASS
  lint:workflows (github-actionlint)                PASS
  typecheck                                         PASS
  test                                              PASS (25 archivos, 188 tests; logger.ts 100 % de líneas)
  build                                             PASS (web + 6 artefactos Lambda .js y .zip)
  terraform:format                                  PASS
  terraform:validate                                PASS (bootstrap, sandbox, demo, production, ephemeral)
  security                                          PASS
  sync:check                                        PASS
terraform plan sin conexión a AWS     PASS (sandbox 52, demo 51, production 51 recursos)
npm run test:e2e / test:e2e:local     NO EJECUTADOS: ningún flujo de usuario cambia
```

Entorno: Node 24.17.0, npm 11.13.0, Terraform 1.15.5 y tflint 0.64.0
(descargado de la release oficial y verificado con su `checksums.txt`). La rama
se rebasó sobre `origin/main` tras la issue #11 (raíces por entorno y
`modules/findly-stack`); los resultados son de la rama ya rebasada.

**Tres defectos previos de la base impedían ejecutar `npm run verify` y
`npm run harness:check` en Windows, y se corrigen en esta rama** (commit
`fix(dev)`), porque bloqueaban el hook `pre-push` sin relación con esta issue:

- `lint:workflows` pasaba `.github/workflows/*.yml` sin comillas y `cmd.exe` no
  expande el comodín, así que `verify` se detenía en ese paso. Ahora es
  `github-actionlint` a secas, que descubre los workflows del repositorio; se
  comprobó que falla (código 1) con un workflow inválido.
- `lint:terraform` era un bucle `for d in …; do …; done` de shell POSIX, que
  `cmd.exe` no ejecuta. Ahora lo ejecuta `scripts/terraform-lint.mjs` con la misma
  lista de roots y el mismo nombre de script npm, de modo que CI no cambia; falla
  con código 1 si `tflint` no está disponible.
- `scripts/check-local-validation-environment.mjs` invocaba
  `spawnSync('npm', ['--version'])` sin shell, lo que falla con `ENOENT` en
  Windows (`npm` es `npm.cmd`) y reportaba "npm 11+ is required" con npm 11.13.
  Ahora ejecuta sus comprobaciones, todas cadenas constantes, mediante shell. Se
  comprobó que sigue fallando de forma cerrada cuando falta una herramienta
  (sin `tflint` en el `PATH` termina con código 1).

Con estas correcciones, `npm run harness:check` y `npm run verify` completos se
ejecutan en Windows y los hooks `pre-push` pueden pasar. El checkout de Windows
tenía además finales de línea CRLF, que Prettier rechaza; se normalizaron a LF
localmente con `core.autocrlf=input`, sin cambios en Git.

## Pendiente tras PR #71

- **Correo:** la recepción SNS → SQS acredita la entrega de la alarma en AWS
  efímero, pero no una suscripción email confirmada ni un mensaje recibido.
- **Budgets:** el plan offline configura el 80 %; falta aplicar el presupuesto
  de cuenta, comprobar su configuración y obtener evidencia de su canal. No se
  genera gasto para forzar el umbral. La identidad que aplique el presupuesto
  requiere permisos revisados para Budgets.
- **Entorno persistente:** los 12 grupos y la alarma probados pertenecían al
  stack efímero destruido. Demo y producción requieren evidencia propia.
- **Presupuesto:** 5 USD es la cifra de demo de la spec 00; producción no tiene
  límite definido. Al ser de cuenta, sólo un entorno por cuenta debe crearlo. No
  hay filtro por etiqueta: exigiría activar la etiqueta en Billing y esperar
  ~24 h.
- **Fuera de alcance:** las métricas de negocio de las specs 00 y 18 (tiempo de
  procesamiento de selfie, p95 de galería, tasas de error de registro y subida) y
  los access logs de API Gateway. Se proponen como issue de seguimiento.
- No se abre ADR: son decisiones de implementación acotadas por las specs 00, 10
  y 12; el registro está en la nota de implementación de la spec 12.

## Métricas de inscripción en demo — 2026-10-04

El run [37198156959](https://github.com/upc-malvaviscos/findly/actions/runs/37198156959)
acredita las cinco series de errores de spec 18/ADR-018 en `Findly/demo`.
La Lambda de telemetría tiene sólo permisos de escritura en su grupo de logs,
retención 14 días y dimensiones sin identificadores de asistentes.
[Evidencia del ciclo](2026-10-04-pr-93-demo-acceptance.md).

Esto completa el criterio de métricas de #22, fuera del alcance original de
PR #64. No se aplica ni prueba Budgets, ni se confirma o recibe correo. #13
permanece abierta por esos criterios; las cinco series no prueban las métricas
de latencia/p95 de negocio ni los access logs pendientes.

<!-- requirement: REQ-OBSERVABILITY -->
