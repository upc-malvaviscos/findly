variable "bucket_name" {
  description = "Nombre del bucket S3 privado para el sitio estatico (dist/)."
  type        = string
}

variable "custom_domain_name" {
  description = "Dominio propio de la distribucion (p.ej. app.findly.example). Vacio por defecto: ningun spec de este proyecto define todavia un dominio ni una zona Route53."
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "ARN del certificado ACM (en us-east-1) para custom_domain_name. Requerido solo si custom_domain_name no esta vacio."
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

variable "data_class" {
  description = "Etiqueta DataClass."
  type        = string
  default     = "public"
}
