# 12 - Observabilidad, alertas y controles de FinOps

## Objetivo
Implementar trazabilidad integral, monitoreo estructurado en CloudWatch Logs mediante la declaración explícita de grupos de logs en Terraform y alertas de presupuestos con AWS Budgets y SNS para detectar errores, controlar costes y garantizar la privacidad.

## Requisitos de Observabilidad y Declaración de Log Groups en Terraform
- **Declaración Explícita de Log Groups**: Para prevenir que AWS cree grupos de logs sin caducidad por defecto, declarar en Terraform `aws_cloudwatch_log_group` por cada Lambda con `retention_in_days = 14`.
```hcl
resource "aws_cloudwatch_log_group" "lambda_log_group" {
  name              = "/aws/lambda/${aws_lambda_function.selfie_indexer.function_name}"
  retention_in_days = 14
}
```
- **Formato JSON Estructurado**: Todas las funciones Lambda emiten logs en JSON con contexto: `correlationId`, `eventId`, `timestamp`, `level`, `action`, `durationMs`.
- **Privacidad Estricta (No PII)**: Prohibición absoluta de registrar nombres, correos electrónicos, imágenes o vectores biométricos en CloudWatch Logs.

## Alertas y Presupuestos (AWS Budgets & CloudWatch Alarms)

### Alarma CloudWatch de SQS DLQ con Notificación SNS
```hcl
resource "aws_sns_topic" "alerts" {
  name = "findly-alerts-topic-${var.environment}"
}

resource "aws_cloudwatch_metric_alarm" "sqs_dlq_alarm" {
  alarm_name          = "findly-sqs-dlq-has-messages-${var.environment}"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Sum"
  threshold           = 1
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    QueueName = aws_sqs_queue.photos_dlq.name
  }
}
```

### FinOps Controls (`aws_budgets_budget`)
```hcl
resource "aws_budgets_budget" "finops" {
  name              = "findly-budget-${var.environment}"
  budget_type       = "COST"
  limit_amount      = var.environment == "production" ? "20" : "5"
  limit_unit        = "USD"
  time_unit         = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}
```

## Criterios de Aceptación
- La matriz de costes por entorno queda documentada en la memoria técnica (`docs/paper/07-finops-observabilidad-y-sostenibilidad.md`).
- Un fallo provocado en Lambda permite rastrear el `correlationId` en CloudWatch sin exponer información personal identificable (PII).
