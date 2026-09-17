variable "api_id" { type = string }
variable "api_execution_arn" { type = string }
variable "table_name" { type = string }
variable "table_arn" { type = string }
variable "uploads_bucket_arn" { type = string }
variable "uploads_bucket_name" { type = string }
variable "user_pool_arn" { type = string }
variable "user_pool_client_id" { type = string }
variable "user_pool_issuer_url" { type = string }
variable "lambda_artifact_path" { type = string }
variable "project" { type = string }
variable "environment" { type = string }
variable "cost_center" { type = string }
variable "data_class" { type = string }
variable "log_retention_days" {
  type    = number
  default = 14
}
