# 12 - Observabilidad, alertas y controles de FinOps

## Objetivo

Implementar trazabilidad integral, monitoreo estructurado en CloudWatch Logs mediante la declaración explícita de grupos de logs en Terraform y alertas de presupuestos con AWS Budgets y SNS para detectar errores, controlar costes y garantizar la privacidad.

## Alineación con AWS Well-Architected Framework

- **Optimización de Costes (FinOps)**: Retención explícita de CloudWatch Logs configurada a 14 días para evitar gastos acumulativos de almacenamiento y presupuesto en AWS Budgets.
- **Excelencia Operativa**: Formato JSON estructurado para logs con `correlationId` para trazabilidad completa sin almacenar datos personales (PII).

## Declaración de Recursos IaC en Terraform

- `aws_cloudwatch_log_group` explícito con `retention_in_days = 14`.
- `aws_sns_topic.alerts` para desviar notificaciones críticas.
- `aws_cloudwatch_metric_alarm` vigilando la cola SQS DLQ (`ApproximateNumberOfMessagesVisible >= 1`).
- `aws_budgets_budget.finops` con alerta por email al alcanzar el 80% del presupuesto.

> **Nota de implementación (issue #13):** la spec nombra `infra/modules/lambda/`
> y sitúa la alarma de la DLQ en `infra/modules/monitoring/`. No existe un módulo
> `lambda`: cada módulo declara los grupos de logs de sus propias Lambdas
> (`admin-api`, `gallery-reader`, `photo-matching` y `retention-purger`), todos
> con `retention_in_days = 14` (variable `log_retention_days`). La alarma de la
> DLQ permanece en `photo-matching`, junto a la cola que vigila, para no
> duplicarla; `monitoring` aporta el topic SNS y el presupuesto, y
> `infra/modules/findly-stack` los enlaza con `dlq_alarm_actions`, de modo que
> los tres roots de entorno (`infra/environments/*`) lo heredan; `infra/ephemeral`
> no usa el stack y no cambia. Decisiones tomadas:
>
> - **Topic SNS único** `findly-{env}-alerts`. Su política sólo admite
>   publicaciones de CloudWatch Alarms y AWS Budgets de la misma cuenta y deniega
>   tráfico sin TLS. No se cifra con `alias/aws/sns`: esos servicios no pueden
>   publicar en un topic cifrado con la clave gestionada; los mensajes sólo llevan
>   nombres de alarma e importes.
> - **Correo opcional y no versionado:** la variable sensible `alert_email` (por
>   defecto `null`) se pasa en el apply con `TF_VAR_alert_email`. El destinatario
>   debe confirmar la suscripción que envía AWS.
> - **Presupuesto:** `budget_limit_usd` vale 5 USD por defecto (cifra de demo de la
>   spec 00; la spec no define ninguna para producción). Es de ámbito de cuenta y
>   no de entorno: el stack no lo crea por defecto (`enable_budget = false`) y sólo
>   el root `sandbox` lo activa, para que tres entornos de una misma cuenta no
>   dupliquen presupuesto ni alertas; si `demo` o `production` viven en otra
>   cuenta, se activa allí. Excluye créditos y reembolsos para que una cuenta con
>   créditos de capa gratuita no quede en coste neto 0 y nunca avise.
> - **Nombres con sufijo de entorno** (`findly-{env}-photos-queue`,
>   `-photos-dlq`, `-photo-matcher`), como exige la spec 10; sin él, dos entornos
>   de una misma cuenta colisionarían. Sustituye a los nombres sin sufijo de la
>   spec 07.
> - **Logs estructurados:** `src/lambdas/lib/logger.ts` escribe una línea JSON con
>   una lista cerrada de campos (`eventId`, `photoId`, `statusCode`, `durationMs`,
>   `errorName` y contadores). Los handlers devuelven al cliente el mismo
>   `correlationId` como `requestId`. Nunca se registran mensajes de error, tokens,
>   nombres, correos, `faceId` ni `registrationId`.

## Estado de implementación

Implementado en la issue #13; la validación y sus límites están en
[`docs/evidence/issue-13-observability-finops.md`](../docs/evidence/issue-13-observability-finops.md).
Nada se ha aplicado todavía en AWS: la verificación es un `terraform plan`
offline y pruebas automatizadas, no un despliegue.

Pendiente, sin cerrar la issue hasta resolverlo:

- Comprobar en AWS que la alarma de la DLQ dispara y que el correo llega
  (issue #46 cubre el desvío a la DLQ).
- La Lambda `deleteRegistration` aún no tiene Terraform (la issue #47, que verifica
  el derecho al olvido en AWS, lo necesitará), por lo que su grupo de logs no
  existe; `retention-purger` no está instanciado en el stack.
- Las métricas de negocio de la spec 00 y la spec 18 (tiempo de procesamiento de
  selfie, p95 de galería, tasas de error de registro/subida) quedan fuera de esta
  spec y requieren una issue de seguimiento.

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Declarar Log Groups Explícitos

- En `infra/modules/lambda/main.tf`, incluye `resource "aws_cloudwatch_log_group"` con `retention_in_days = 14` por cada función Lambda.

### Paso 2: Crear el Módulo de Alertas y Presupuestos

- En `infra/modules/monitoring/main.tf`, declara el tema SNS, la alarma de la cola DLQ y el recurso `aws_budgets_budget`.

## Errores Comunes a Evitar (Pitfalls)

- ❌ **ERROR**: Dejar los grupos de logs de CloudWatch sin el atributo `retention_in_days`.
  - _Solución_: Si omitas este atributo, los logs se almacenarán indefinidamente, generando costes crecientes en AWS.
- ❌ **ERROR**: Imprimir datos personales identificables (nombres, emails, selfies) en `console.log`.
  - _Solución_: Registra solo metadatos (`correlationId`, `eventId`, `status`, `durationMs`).

## Lista de Verificación Pre-PR (Junior Checklist)

- [x] Los Log Groups declarados fijan retención de 14 días (validación estática).
- [ ] Todos los grupos desplegados, incluido DELETE, verifican retención y logs
      JSON sin PII en AWS.
      _(Los 4 bloques declarados —5 grupos en el `terraform plan` de cada root de
      entorno— fijan
      14 días y `tests/infra/observability.test.ts` lo exige en CI. Límite: el
      grupo de `deleteRegistration` no existe hasta que tenga Terraform y el de
      `retention-purger` no se despliega hasta instanciarlo en el stack.)_
- [x] La alarma SQS DLQ está vinculada al tema SNS.
      _(`GreaterThanOrEqualToThreshold` 1 sobre `ApproximateNumberOfMessagesVisible`;
      el stack pasa `module.monitoring.alerts_topic_arn` en `dlq_alarm_actions`.
      Verificado con `terraform plan` offline y prueba estática; sin apply en AWS.)_
- [x] Terraform declara el presupuesto al 80% (plan offline).
- [ ] El presupuesto está aplicado y el canal/disparo real tiene evidencia AWS.
      _(`GREATER_THAN` 80 % de gasto `ACTUAL` sobre 5 USD, publicando en el topic;
      verificado con `terraform plan` offline y prueba estática. El aviso real
      requiere una suscripción de correo confirmada y no se ha probado en AWS.)_

La issue #13 permanece abierta: PR #64 valida configuración offline, no
alarma/entrega SNS ni presupuesto aplicados. Un ALARM sin recepción no prueba
entrega; publicar manualmente en SNS no prueba el umbral de AWS Budgets.
