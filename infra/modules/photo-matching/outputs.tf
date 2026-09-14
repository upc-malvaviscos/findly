output "queue_arn" {
  description = "ARN de la cola SQS findly-photos-queue."
  value       = aws_sqs_queue.photos.arn
}

output "dlq_arn" {
  description = "ARN de la DLQ findly-photos-dlq."
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
