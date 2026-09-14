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
