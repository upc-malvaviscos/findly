# 12 - Observabilidad, alertas y controles de FinOps

## Objetivo
Implementar trazabilidad integral, monitoreo estructurado en CloudWatch Logs y alertas de presupuestos mediante AWS Budgets para detectar errores, controlar costes y garantizar la privacidad de los datos personales.

## Requisitos de Observabilidad y Logs
- **Formato JSON Estructurado**: Todas las funciones Lambda emiten logs en JSON con contexto: `correlationId`, `eventId`, `timestamp`, `level`, `action`, `durationMs`.
- **Privacidad Estricta (No PII)**: Prohibición absoluta de registrar nombres, correos electrónicos, imágenes o vectores biométricos en CloudWatch Logs.
- **Retención de Logs**: Configurada exactamente a 14 días en `aws_cloudwatch_log_group` para minimizar costes de almacenamiento.

## Alertas y Presupuestos (AWS Budgets & CloudWatch Alarms)

### Alerta CloudWatch de Fallo en Lambda y SQS DLQ
- Alarma CloudWatch por errores en Lambda > 2%.
- Alarma CloudWatch si la cola SQS DLQ (`findly-photos-dlq`) contiene 1 o más mensajes visibles (`ApproximateNumberOfMessagesVisible > 0`).

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
