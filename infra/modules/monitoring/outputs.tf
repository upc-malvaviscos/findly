output "alerts_topic_arn" {
  description = "ARN del topic SNS de alertas; pasalo como destino de alarmas (alarm_actions)."
  value       = aws_sns_topic.alerts.arn
}

output "budget_name" {
  description = "Nombre del presupuesto mensual, o null si enable_budget es false."
  value       = one(aws_budgets_budget.finops[*].name)
}
