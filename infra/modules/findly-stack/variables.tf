variable "aws_region" {
  description = "AWS region of the managed resources."
  type        = string
  default     = "eu-west-1"
}
variable "project" {
  description = "Project tag."
  type        = string
  default     = "findly"
}
variable "environment" {
  description = "Isolated environment (sandbox, demo or production); set by each environment root."
  type        = string
}
variable "cost_center" {
  description = "CostCenter tag."
  type        = string
  default     = "findly"
}
variable "data_class" {
  description = "DataClass tag for sensitive data."
  type        = string
  default     = "biometric"
}
variable "frontend_domain_url" {
  description = "Exact HTTPS or local origin allowed by CORS."
  type        = string
}
variable "uploads_bucket_name" {
  description = "Globally unique name of the private uploads bucket."
  type        = string
}

variable "gallery_lambda_artifact_path" {
  description = "Path to the GalleryReader zip; defaults to artifacts/lambdas/gallery.zip built by npm run package:lambdas."
  type        = string
  default     = null
}

variable "allow_bucket_destroy" {
  description = "Allows emptying and destroying the uploads bucket. Must be false in demo and production to prevent accidental data loss."
  type        = bool
  default     = false
}

variable "alert_email" {
  description = "Email that receives alerts (photos DLQ alarm and budget). Contact data: pass it at apply time with TF_VAR_alert_email, never in a tracked file. null = no subscription."
  type        = string
  default     = null
  sensitive   = true
}

variable "budget_limit_usd" {
  description = "Monthly budget limit in USD; warns at 80 % of actual spend. Spec 00 sets 5 USD for the demo."
  type        = string
  default     = "5"
}

variable "enable_budget" {
  description = "Creates the cost budget. It is account-wide: only one environment per account should enable it, so it defaults to false and sandbox opts in."
  type        = bool
  default     = false
}

variable "enable_web" {
  description = "Opt-in to provision static hosting after domain and deployment permissions review."
  type        = bool
  default     = false
}
variable "web_bucket_name" {
  description = "Globally unique private web bucket name; required when enable_web is true."
  type        = string
  default     = ""
}
variable "web_domain_name" {
  description = "Approved frontend domain; required for TLSv1.2_2021."
  type        = string
  default     = ""
}
variable "web_certificate_arn" {
  description = "Existing ACM certificate ARN in us-east-1 for web_domain_name."
  type        = string
  default     = ""
}
