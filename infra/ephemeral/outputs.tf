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

output "public_function_names" { value = module.public_enrollment.lambda_function_names }
output "selfie_indexer_function_name" { value = module.selfie_indexer.lambda_function_name }

output "collection_namespace" { value = "findly-${local.environment}" }

output "frontend_origin" { value = var.frontend_domain_url }
output "lambda_function_names" {
  value = concat(values(module.public_enrollment.lambda_function_names), module.admin_api.function_names, [
    module.selfie_indexer.lambda_function_name,
    module.gallery_reader.function_name,
    module.delete_registration.lambda_function_name,
    module.retention_purger.function_name,
    module.photo_matching.function_name,
  ])
}
