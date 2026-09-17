variable "bucket_name" {
  description = "Nombre del bucket S3 privado para selfies y fotos de evento."
  type        = string
}

variable "frontend_domain_url" {
  description = "Origen exacto del frontend autorizado por la politica CORS del bucket."
  type        = string
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
  description = "Etiqueta DataClass (clasificacion de sensibilidad de los datos almacenados)."
  type        = string
  default     = "biometric"
}

variable "force_destroy" {
  description = "Permite vaciar el bucket solo para entornos efimeros de CI."
  type        = bool
  default     = false
}
