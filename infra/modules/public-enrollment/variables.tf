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
variable "api_id" {
  type        = string
  description = "api id."
}
variable "api_execution_arn" {
  type        = string
  description = "api execution arn."
}
variable "public_events_artifact_path" {
  type        = string
  description = "public events artifact path."
}
variable "public_enrollment_artifact_path" {
  type        = string
  description = "public enrollment artifact path."
}
