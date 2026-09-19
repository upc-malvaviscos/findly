variable "alert_email" {
  description = "Correo que recibe las alertas por SNS. Es un dato de contacto: se pasa en el apply (TF_VAR_alert_email) y nunca se versiona. null = sin suscripcion."
  type        = string
  default     = null
  sensitive   = true

  validation {
    condition     = var.alert_email == null || can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alert_email))
    error_message = "alert_email debe ser una direccion de correo valida o null."
  }
}

variable "budget_limit_usd" {
  description = "Limite mensual del presupuesto en USD; avisa al 80 % del gasto real. La spec 00 fija 5 USD para demo."
  type        = string
  default     = "5"

  validation {
    condition     = can(tonumber(var.budget_limit_usd)) ? tonumber(var.budget_limit_usd) > 0 : false
    error_message = "budget_limit_usd debe ser un importe positivo en USD, por ejemplo \"5\"."
  }
}

variable "enable_budget" {
  description = "Crea el presupuesto. Es de ambito de cuenta: si varios entornos comparten cuenta, activalo solo en uno."
  type        = bool
  default     = true
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
