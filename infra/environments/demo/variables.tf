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

variable "cost_center" {
  description = "CostCenter tag."
  type        = string
  default     = "findly"
}

variable "data_class" {
  description = "DataClass tag for sensitive data."
  type        = string
}

variable "frontend_domain_url" {
  description = "Exact HTTPS or local origin allowed by CORS."
  type        = string
}

variable "uploads_bucket_name" {
  description = "Globally unique name of the private uploads bucket; includes the environment suffix."
  type        = string
}

variable "alert_email" {
  description = "Email that receives alerts (photos DLQ alarm and budget). Contact data: pass it at apply time with TF_VAR_alert_email, never in terraform.tfvars. null = no subscription."
  type        = string
  default     = null
  sensitive   = true
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
