variable "user_pool_name" {
  description = "Nombre del User Pool de Cognito para organizadores."
  type        = string
  default     = "findly-organizers"
}

variable "project" {
  description = "Etiqueta Project."
  type        = string
  default     = "findly"
}

variable "environment" {
  description = "Etiqueta Environment (p.ej. sandbox, demo)."
  type        = string
}

variable "cost_center" {
  description = "Etiqueta CostCenter."
  type        = string
  default     = "findly"
}

variable "data_class" {
  description = "Etiqueta DataClass."
  type        = string
  default     = "biometric"
}

variable "admin_login_url" {
  description = "Environment-specific administrator login URL included in Cognito invitations."
  type        = string

  validation {
    condition     = can(regex("^https?://[^/?#]+/admin/login$", var.admin_login_url))
    error_message = "Administrator login URL must use HTTP(S) and end in /admin/login."
  }
}
