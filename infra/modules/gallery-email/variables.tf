variable "project" {
  description = "Gallery email project."
  type        = string
  default     = "findly"
}

variable "environment" {
  description = "Gallery email environment."
  type        = string
}

variable "cost_center" {
  description = "Gallery email cost center."
  type        = string
  default     = "findly"
}

variable "data_class" {
  description = "Gallery email data class."
  type        = string
  default     = "biometric"
}

variable "table_name" {
  description = "Gallery email table name."
  type        = string
}

variable "table_arn" {
  description = "Gallery email table arn."
  type        = string
}

variable "uploads_bucket_name" {
  description = "Gallery email uploads bucket name."
  type        = string
}

variable "uploads_bucket_arn" {
  description = "Gallery email uploads bucket arn."
  type        = string
}

variable "api_id" {
  description = "Gallery email api id."
  type        = string
}

variable "api_execution_arn" {
  description = "Gallery email api execution arn."
  type        = string
}

variable "authorizer_id" {
  description = "Gallery email authorizer id."
  type        = string
}

variable "identity_arn" {
  description = "Gallery email identity arn."
  type        = string
}

variable "from_address" {
  description = "Gallery email from address."
  type        = string
  default     = ""
}

variable "gallery_origin" {
  validation {
    condition     = can(regex("^https://[a-zA-Z0-9.-]+$", var.gallery_origin))
    error_message = "Use an HTTPS gallery origin without a path or query. Secrets must not appear in configured URLs."
  }
  description = "Gallery email gallery origin."
  type        = string
  default     = "https://findly.barcelona"
}

variable "artifact_path" {
  description = "Gallery email artifact path."
  type        = string
}

variable "feedback_artifact_path" {
  description = "Gallery email feedback artifact path."
  type        = string
}

variable "alarm_actions" {
  description = "Gallery email alarm actions."
  type        = list(string)
  default     = []
}
