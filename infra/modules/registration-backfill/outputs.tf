output "queue_arn" {
  description = "ARN de la cola SQS de backfill (findly-{env}-backfill-queue)."
  value       = aws_sqs_queue.backfill.arn
}

output "queue_url" {
  description = "URL de la cola SQS de backfill, inyectada en SelfieIndexer como FINDLY_BACKFILL_QUEUE_URL."
  value       = aws_sqs_queue.backfill.url
}

output "dlq_arn" {
  description = "ARN de la DLQ de backfill (findly-{env}-backfill-dlq)."
  value       = aws_sqs_queue.backfill_dlq.arn
}

output "dlq_url" { value = aws_sqs_queue.backfill_dlq.url }

output "function_arn" {
  description = "ARN de la Lambda RegistrationBackfill."
  value       = aws_lambda_function.registration_backfill.arn
}

output "function_name" {
  description = "Nombre de la Lambda RegistrationBackfill."
  value       = aws_lambda_function.registration_backfill.function_name
}

output "dlq_alarm_name" { value = aws_cloudwatch_metric_alarm.backfill_dlq_has_messages.alarm_name }
