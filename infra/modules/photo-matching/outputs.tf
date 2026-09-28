output "queue_arn" {
  description = "ARN de la cola SQS de fotos (findly-{env}-photos-queue)."
  value       = aws_sqs_queue.photos.arn
}

output "dlq_arn" {
  description = "ARN de la DLQ de fotos (findly-{env}-photos-dlq)."
  value       = aws_sqs_queue.photos_dlq.arn
}

output "function_arn" {
  description = "ARN de la Lambda PhotoMatcher."
  value       = aws_lambda_function.photo_matcher.arn
}

output "function_name" {
  description = "Nombre de la Lambda PhotoMatcher."
  value       = aws_lambda_function.photo_matcher.function_name
}

output "queue_url" { value = aws_sqs_queue.photos.url }
output "dlq_url" { value = aws_sqs_queue.photos_dlq.url }
output "dlq_alarm_name" { value = aws_cloudwatch_metric_alarm.photos_dlq_has_messages.alarm_name }
