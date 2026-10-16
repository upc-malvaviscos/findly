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

variable "permissions_boundary_arn" {
  description = "Optional runtime permissions ceiling; mandatory for the production stack."
  type        = string
  default     = null
}

variable "backfill_queue_arn" {
  description = "Optional RegistrationBackfill queue ARN (issue #87/ADR-022); null skips the send-only grant and the post-ENROLLED trigger stays disabled."
  type        = string
  default     = null
}

variable "backfill_queue_url" {
  description = "Optional RegistrationBackfill queue URL, injected as FINDLY_BACKFILL_QUEUE_URL when backfill_queue_arn is set."
  type        = string
  default     = null
}
