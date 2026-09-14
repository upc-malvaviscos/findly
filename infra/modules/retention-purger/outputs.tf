output "function_arn" {
  description = "ARN de la Lambda RetentionPurger."
  value       = aws_lambda_function.retention_purger.arn
}

output "function_name" {
  description = "Nombre de la Lambda RetentionPurger."
  value       = aws_lambda_function.retention_purger.function_name
}

output "schedule_arn" {
  description = "ARN del schedule de EventBridge Scheduler."
  value       = aws_scheduler_schedule.retention_purger.arn
}
