variable "email_identity_arn" {
  description = "Optional verified SES domain identity for Cognito invitations, independent of gallery email."
  type        = string
  default     = ""
  validation {
    condition     = var.email_identity_arn == "" || can(regex("^arn:aws:ses:eu-west-1:[0-9]{12}:identity/[a-z0-9.-]+$", var.email_identity_arn))
    error_message = "Cognito email requires a verified eu-west-1 SES domain identity."
  }
}

variable "email_from_address" {
  description = "Optional Cognito SES sender address."
  type        = string
  default     = ""
  validation {
    condition     = var.email_from_address == "" || can(regex("^[^@ ]+@[^@ ]+[.][^@ ]+$", var.email_from_address))
    error_message = "Set a valid Cognito sender address."
  }
}

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
