variable "aws_region" {
  description = "Región AWS de los recursos gestionados."
  type        = string
  default     = "eu-west-1"
}
variable "project" {
  description = "Etiqueta Project."
  type        = string
  default     = "findly"
}
variable "environment" {
  description = "Entorno aislado, por ejemplo sandbox, demo o production."
  type        = string
}
variable "cost_center" {
  description = "Etiqueta CostCenter."
  type        = string
  default     = "findly"
}
variable "data_class" {
  description = "Etiqueta DataClass para datos sensibles."
  type        = string
  default     = "biometric"
}
variable "frontend_domain_url" {
  description = "Origen HTTPS o local exacto autorizado por CORS."
  type        = string
}
variable "uploads_bucket_name" {
  description = "Nombre globalmente único del bucket privado de subidas."
  type        = string
}

variable "gallery_lambda_artifact_path" {
  description = "Ruta al zip de GalleryReader generado por npm run package:lambdas."
  type        = string
  default     = "../artifacts/lambdas/gallery.zip"
}
