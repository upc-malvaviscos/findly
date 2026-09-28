variable "project" {
  type        = string
  description = "project."
}
variable "environment" {
  type        = string
  description = "environment."
}
variable "cost_center" {
  type        = string
  description = "cost center."
}
variable "data_class" {
  type        = string
  description = "data class."
}
variable "table_name" {
  type        = string
  description = "table name."
}
variable "table_arn" {
  type        = string
  description = "table arn."
}
variable "uploads_bucket_name" {
  type        = string
  description = "uploads bucket name."
}
variable "uploads_bucket_arn" {
  type        = string
  description = "uploads bucket arn."
}
variable "lambda_artifact_path" {
  type        = string
  description = "lambda artifact path."
}
