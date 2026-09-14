variable "repository" {
  description = "Repositorio GitHub owner/repo autorizado a asumir el rol (p.ej. upc-malvaviscos/findly)."
  type        = string
  default     = "upc-malvaviscos/findly"
}

variable "allowed_ref" {
  description = "Ref de Git al que restringir la asuncion del rol (p.ej. 'ref:refs/heads/main'). Vacio por defecto: permite cualquier ref del repositorio, ya que la spec solo exige restringir al repositorio; restringelo cuando la issue de despliegue defina el flujo real de CI/CD."
  type        = string
  default     = ""
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
