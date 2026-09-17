output "api_endpoint" {
  description = "URL base del HTTP API."
  value       = module.api_gateway.api_endpoint
}
output "api_id" {
  description = "Identificador del HTTP API."
  value       = module.api_gateway.api_id
}
output "api_execution_arn" {
  description = "ARN de ejecución para permisos de rutas."
  value       = module.api_gateway.execution_arn
}
output "table_name" {
  description = "Nombre de la tabla DynamoDB de tabla única."
  value       = module.dynamodb.table_name
}
output "table_arn" {
  description = "ARN de la tabla DynamoDB."
  value       = module.dynamodb.table_arn
}
output "uploads_bucket_name" {
  description = "Nombre del bucket privado de subidas."
  value       = module.uploads_bucket.bucket_name
}
output "uploads_bucket_arn" {
  description = "ARN del bucket privado de subidas."
  value       = module.uploads_bucket.bucket_arn
}
