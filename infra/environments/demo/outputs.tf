output "api_endpoint" {
  value = module.findly.api_endpoint
}

output "api_id" {
  value = module.findly.api_id
}

output "api_execution_arn" {
  value = module.findly.api_execution_arn
}

output "table_name" {
  value = module.findly.table_name
}

output "table_arn" {
  value = module.findly.table_arn
}

output "uploads_bucket_name" {
  value = module.findly.uploads_bucket_name
}

output "uploads_bucket_arn" {
  value = module.findly.uploads_bucket_arn
}

output "cognito_user_pool_id" {
  value = module.findly.cognito_user_pool_id
}

output "cognito_client_id" {
  value = module.findly.cognito_client_id
}

output "cognito_region" {
  value = module.findly.cognito_region
}

output "gallery_reader_function_name" {
  value = module.findly.gallery_reader_function_name
}

output "alerts_topic_arn" {
  value = module.findly.alerts_topic_arn
}

output "web_bucket_name" { value = module.findly.web_bucket_name }
output "web_distribution_id" { value = module.findly.web_distribution_id }
output "web_distribution_domain_name" { value = module.findly.web_distribution_domain_name }

output "delete_registration_function_name" { value = module.findly.delete_registration_function_name }
output "retention_purger_function_name" { value = module.findly.retention_purger_function_name }

output "public_function_names" { value = module.findly.public_function_names }
output "selfie_indexer_function_name" { value = module.findly.selfie_indexer_function_name }
