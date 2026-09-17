output "environment" { value = local.environment }
output "api_endpoint" { value = module.api_gateway.api_endpoint }
output "cognito_user_pool_id" { value = module.cognito.user_pool_id }
output "cognito_client_id" { value = module.cognito.client_id }
output "uploads_bucket_name" { value = module.uploads_bucket.bucket_name }
