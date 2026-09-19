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
