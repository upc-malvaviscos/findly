variable "api_id" {
  description = "ID del HTTP API que expone la galería pública."
  type        = string
}

variable "api_execution_arn" {
  description = "ARN de ejecución del HTTP API para restringir la invocación Lambda."
  type        = string
}

variable "table_name" {
  description = "Nombre de la tabla DynamoDB de Findly."
  type        = string
}

variable "table_arn" {
  description = "ARN de la tabla DynamoDB de Findly."
  type        = string
}

variable "uploads_bucket_name" {
  description = "Nombre del bucket privado que contiene fotos del evento."
  type        = string
}

variable "uploads_bucket_arn" {
  description = "ARN del bucket privado que contiene fotos del evento."
  type        = string
}

variable "lambda_artifact_path" {
  description = "Ruta al zip empaquetado de GalleryReader (artifacts/lambdas/gallery.zip)."
  type        = string
}

variable "frontend_domain_url" {
  description = "Origen exacto autorizado para CORS en las respuestas de la Lambda."
  type        = string
}

variable "project" {
  type    = string
  default = "findly"
}

variable "environment" { type = string }

variable "cost_center" {
  type    = string
  default = "findly"
}

variable "data_class" {
  type    = string
  default = "biometric"
}

variable "log_retention_days" {
  description = "Días de retención de logs de GalleryReader."
  type        = number
  default     = 14
}
