output "api_endpoint" {
  description = "Base URL of the HTTP API."
  value       = module.api_gateway.api_endpoint
}
output "api_id" {
  description = "HTTP API identifier."
  value       = module.api_gateway.api_id
}
output "api_execution_arn" {
  description = "Execution ARN used for route permissions."
  value       = module.api_gateway.execution_arn
}
output "table_name" {
  description = "Name of the single-table DynamoDB table."
  value       = module.dynamodb.table_name
}
output "table_arn" {
  description = "DynamoDB table ARN."
  value       = module.dynamodb.table_arn
}
output "uploads_bucket_name" {
  description = "Name of the private uploads bucket."
  value       = module.uploads_bucket.bucket_name
}
output "uploads_bucket_arn" {
  description = "ARN of the private uploads bucket."
  value       = module.uploads_bucket.bucket_arn
}
output "cognito_user_pool_id" { value = module.cognito.user_pool_id }
output "cognito_client_id" { value = module.cognito.client_id }
output "cognito_region" { value = var.aws_region }

output "gallery_reader_function_name" {
  description = "Name of the public Lambda that resolves private galleries."
  value       = module.gallery_reader.function_name
}
