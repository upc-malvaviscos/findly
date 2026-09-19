# Evidencia de observabilidad y FinOps

Implementación de la spec 12 ([issue #13](https://github.com/upc-malvaviscos/findly/issues/13)):
logs estructurados con `correlationId` sin datos personales, alerta de la DLQ de
fotos hacia SNS y un presupuesto de AWS Budgets que avisa al 80 %.

**Nada se ha aplicado en AWS.** La evidencia es un `terraform plan` offline y
pruebas automatizadas; el comportamiento real (alarma que dispara, correo que
llega) sigue sin demostrar y se lista en [Pendiente](#pendiente).

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

## Criterios de la spec 12

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
npm run lint:code                     PASS
npm run lint:format                   PASS
npm run lint:markdown                 PASS
npm run lint:terraform (tflint 0.64)  PASS
github-actionlint (5 workflows)       PASS (esta issue no modifica workflows)
npm run typecheck                     PASS
npm run test                          PASS (22 archivos, 148 tests; logger.ts 100 % de líneas)
npm run build                         PASS (web + 6 artefactos Lambda .js y .zip)
npm run terraform:format              PASS
npm run terraform:validate            PASS (raíz infra/)
npm run security                      PASS
npm run sync:check                    PASS
terraform plan sin conexión a AWS     PASS (52 recursos)
npm run test:e2e / test:e2e:local     NO EJECUTADOS: ningún flujo de usuario cambia
```

Entorno: Node 24.17.0, npm 11.13.0, Terraform 1.15.5 y tflint 0.64.0
(descargado de la release oficial y verificado con su `checksums.txt`).

**`npm run verify` y `npm run harness:check` no se ejecutan tal cual en
Windows**, por dos defectos previos de la base, ajenos a esta issue: en
`package.json`, `lint:workflows` pasa `.github/workflows/*.yml` sin comillas y
`cmd.exe` no expande el comodín, así que `verify` se detiene en ese paso; y
`scripts/check-local-validation-environment.mjs` invoca
`spawnSync('npm', ['--version'])` sin shell, lo que falla con `ENOENT` en Windows
(`npm` es `npm.cmd`) y reporta erróneamente "npm 11+ is required" con npm 11.13.
Por eso cada paso de `verify` se ejecutó por separado y los hooks `pre-push`
(que ejecutan ambos comandos) no pueden pasar en esta máquina sin corregirlos.
El checkout de Windows tenía además finales de línea CRLF, que Prettier rechaza;
se normalizaron a LF localmente con `core.autocrlf=input`, sin cambios en Git.

## Pendiente

- **Sin apply en AWS:** no se ha demostrado que la alarma dispare ni que el
  correo llegue. La issue #46 cubre el desvío a la DLQ y debería incluir la
  entrega de la alerta. La issue #13 no se cierra hasta entonces.
- **Cobertura de logs incompleta:** `deleteRegistration` no tiene Terraform en
  `origin/main` (la issue #47 pide verificar el derecho al olvido en AWS y lo
  necesitará), así que su grupo de logs no existe; `retention-purger` está
  declarado pero no instanciado en el stack, y la raíz efímera de PR no incluye
  `photo-matching` ni `monitoring` a propósito (el presupuesto es de cuenta y el
  rol OIDC efímero no tiene permisos de SNS ni Budgets).
- **Efecto en el sandbox:** con `photo-matching` en el stack, subir una foto a
  `events/{id}/photos/*.jpg` (por ejemplo, `npm run test:aws`) dispara
  `PhotoMatcher`. Sin colección de Rekognition —la indexación de selfies, issue
  #7, no está implementada— cabe esperar que el mensaje falle tres veces
  (`maxReceiveCount = 3`) y termine en la DLQ, activando la alarma; avisaría por
  correo sólo si hay un `alert_email` confirmado. No se ha comprobado en AWS.
- **Permisos del despliegue:** la política del rol `findly-github-actions-{env}`
  de la rama de la issue #15 (aún sin fusionar) no incluye acciones `sns:` ni
  `budgets:`. Deberá ampliarse
  (`sns:CreateTopic`, `sns:SetTopicAttributes`, `sns:Subscribe`,
  `sns:TagResource`, `sns:DeleteTopic`, `budgets:ModifyBudget`,
  `budgets:ViewBudget`, `budgets:TagResource`) cuando esa PR se integre con esta.
  Una identidad de sandbox sin permisos de Budgets debe usar
  `TF_VAR_enable_budget=false`.
- **Presupuesto:** 5 USD es la cifra de demo de la spec 00; producción no tiene
  límite definido. Al ser de cuenta, sólo un entorno por cuenta debe crearlo. No
  hay filtro por etiqueta: exigiría activar la etiqueta en Billing y esperar
  ~24 h.
- **Fuera de alcance:** las métricas de negocio de las specs 00 y 18 (tiempo de
  procesamiento de selfie, p95 de galería, tasas de error de registro y subida) y
  los access logs de API Gateway. Se proponen como issue de seguimiento.
- No se abre ADR: son decisiones de implementación acotadas por las specs 00, 10
  y 12; el registro está en la nota de implementación de la spec 12.
