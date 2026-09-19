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
