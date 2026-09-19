terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0, < 6.0"
    }
  }
}

locals {
  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "Terraform"
    CostCenter  = var.cost_center
    DataClass   = var.data_class
  }
  topic_name = "${var.project}-${var.environment}-alerts"
}

# Unico destino de alertas: la alarma de la DLQ de fotos (modulo
# photo-matching, via dlq_alarm_actions) y el presupuesto publican aqui.
#
# Deliberadamente sin cifrado con la clave gestionada alias/aws/sns: CloudWatch
# Alarms y AWS Budgets no pueden publicar en un topic cifrado con ella (su
# politica de clave no es editable). Los mensajes solo llevan el nombre de la
# alarma o importes de coste, nunca datos personales ni biometricos.
resource "aws_sns_topic" "alerts" {
  name = local.topic_name
  tags = local.tags
}

resource "aws_sns_topic_policy" "alerts" {
  arn = aws_sns_topic.alerts.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudWatchAlarmsFromThisAccount"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.alerts.arn
        Condition = {
          StringEquals = { "aws:SourceAccount" = aws_sns_topic.alerts.owner }
          ArnLike      = { "aws:SourceArn" = "arn:aws:cloudwatch:*:${aws_sns_topic.alerts.owner}:alarm:*" }
        }
      },
      {
        Sid       = "AllowBudgetsFromThisAccount"
        Effect    = "Allow"
        Principal = { Service = "budgets.amazonaws.com" }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.alerts.arn
        Condition = {
          StringEquals = { "aws:SourceAccount" = aws_sns_topic.alerts.owner }
          ArnLike      = { "aws:SourceArn" = "arn:aws:budgets::${aws_sns_topic.alerts.owner}:*" }
        }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.alerts.arn
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      },
    ]
  })
}

# El correo es un dato de contacto: llega como variable en el apply y no se
# versiona. Terraform no puede confirmar la suscripcion; el destinatario debe
# pulsar el enlace del correo de AWS antes de recibir alertas.
resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email == null ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# Un presupuesto de costes es de ambito de cuenta, no de entorno (filtrar por
# etiqueta exige activarla antes en Billing y tarda ~24 h): si varios entornos
# comparten cuenta, solo uno debe crearlo (enable_budget).
resource "aws_budgets_budget" "finops" {
  count = var.enable_budget ? 1 : 0

  name         = "${var.project}-${var.environment}-monthly-cost"
  budget_type  = "COST"
  limit_amount = var.budget_limit_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Sin creditos ni reembolsos: en una cuenta con creditos de capa gratuita el
  # coste neto seria 0 y el aviso nunca saltaria.
  cost_types {
    include_credit = false
    include_refund = false
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 80
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_sns_topic_arns = [aws_sns_topic.alerts.arn]
  }

  # Budgets valida al crear que puede publicar en el topic.
  depends_on = [aws_sns_topic_policy.alerts]

  tags = local.tags
}
