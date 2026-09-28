output "environment" { value = local.environment }
output "api_endpoint" { value = module.api_gateway.api_endpoint }
output "cognito_user_pool_id" { value = module.cognito.user_pool_id }
output "cognito_client_id" { value = module.cognito.client_id }
output "uploads_bucket_name" { value = module.uploads_bucket.bucket_name }
output "dynamodb_table_name" { value = module.dynamodb.table_name }

output "delete_registration_function_name" { value = module.delete_registration.lambda_function_name }
output "retention_purger_function_name" { value = module.retention_purger.function_name }

output "photos_queue_url" { value = module.photo_matching.queue_url }
output "photos_dlq_url" { value = module.photo_matching.dlq_url }
output "photos_dlq_alarm_name" { value = module.photo_matching.dlq_alarm_name }
output "alert_probe_queue_url" { value = aws_sqs_queue.alert_probe.url }
