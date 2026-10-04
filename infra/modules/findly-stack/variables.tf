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
  description = "Opt-in to provision static hosting after deployment permissions review."
  type        = bool
  default     = false
}
variable "web_bucket_name" {
  description = "Globally unique private web bucket name; required when enable_web is true."
  type        = string
  default     = ""
}
variable "web_domain_name" {
  description = "Optional custom frontend domain in demo; empty uses the CloudFront domain. Required outside demo."
  type        = string
  default     = ""
}
variable "web_certificate_arn" {
  description = "ACM certificate ARN in us-east-1, required only with a custom domain."
  type        = string
  default     = ""
}

variable "email_identity_arn" {
  description = "Verified SES identity in eu-west-1; empty disables gallery email. Provision identity separately from environment teardown."
  type        = string
  default     = ""
}
variable "email_from_address" {
  description = "Approved gallery sender."
  type        = string
  default     = ""
}
variable "email_gallery_origin" {
  description = "Own HTTPS origin with a working /gallery route. Verify before enabling email."
  type        = string
  default     = "https://findly.barcelona"
  validation {
    condition     = can(regex("^https://[a-zA-Z0-9.-]+$", var.email_gallery_origin))
    error_message = "Gallery origin must be an HTTPS origin without a path."
  }
}

variable "permissions_boundary_arn" {
  description = "Optional runtime permissions ceiling; mandatory for the production stack."
  type        = string
  default     = null
  validation {
    condition     = var.environment != "production" || var.permissions_boundary_arn != null
    error_message = "Production requires a reviewed runtime permissions boundary."
  }
}
