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

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Declarar Log Groups Explícitos
- En `infra/modules/lambda/main.tf`, incluye `resource "aws_cloudwatch_log_group"` con `retention_in_days = 14` por cada función Lambda.

### Paso 2: Crear el Módulo de Alertas y Presupuestos
- En `infra/modules/monitoring/main.tf`, declara el tema SNS, la alarma de la cola DLQ y el recurso `aws_budgets_budget`.

## Errores Comunes a Evitar (Pitfalls)
- ❌ **ERROR**: Dejar los grupos de logs de CloudWatch sin el atributo `retention_in_days`.
  - *Solución*: Si omitas este atributo, los logs se almacenarán indefinidamente, generando costes crecientes en AWS.
- ❌ **ERROR**: Imprimir datos personales identificables (nombres, emails, selfies) en `console.log`.
  - *Solución*: Registra solo metadatos (`correlationId`, `eventId`, `status`, `durationMs`).

## Lista de Verificación Pre-PR (Junior Checklist)
- [ ] Todos los Log Groups de CloudWatch tienen retención fijada a 14 días.
- [ ] La alarma SQS DLQ está vinculada al tema SNS.
- [ ] El presupuesto de AWS Budgets está configurado para avisar al 80%.
