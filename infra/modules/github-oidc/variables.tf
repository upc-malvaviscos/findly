variable "repository" {
  description = "Repositorio GitHub owner/repo autorizado a asumir los roles (p.ej. upc-malvaviscos/findly)."
  type        = string
  default     = "upc-malvaviscos/findly"
}

variable "environments" {
  description = "Entornos para los que crear un rol de despliegue independiente (findly-github-actions-{entorno})."
  type        = list(string)
  default     = ["sandbox", "demo", "production"]
}

variable "project" {
  description = "Etiqueta Project."
  type        = string
  default     = "findly"
}

variable "cost_center" {
  description = "Etiqueta CostCenter."
  type        = string
  default     = "findly"
}
