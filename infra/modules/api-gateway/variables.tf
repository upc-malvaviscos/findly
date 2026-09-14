variable "table_name" {
  description = "Nombre de la tabla DynamoDB de tabla unica (findly-{env})."
  type        = string
}

variable "table_arn" {
  description = "ARN de la tabla DynamoDB, usado para permisos IAM de minimo privilegio."
  type        = string
}

variable "uploads_bucket_name" {
  description = "Nombre del bucket S3 de subidas (infra/modules/uploads-bucket)."
  type        = string
}

variable "uploads_bucket_arn" {
  description = "ARN del bucket S3 de subidas, usado para permisos IAM."
  type        = string
}

variable "gallery_artifact_path" {
  description = "Ruta al zip empaquetado de la Lambda gallery (artifacts/lambdas/gallery.zip)."
  type        = string
}

variable "delete_registration_artifact_path" {
  description = "Ruta al zip empaquetado de la Lambda deleteRegistration (artifacts/lambdas/deleteRegistration.zip)."
  type        = string
}

variable "cognito_issuer_url" {
  description = "URL del emisor del User Pool de Cognito (salida issuer_url de infra/modules/cognito), para el autorizador JWT de rutas administrativas."
  type        = string
}

variable "cognito_client_id" {
  description = "Id del App Client de Cognito (salida client_id de infra/modules/cognito), audiencia del autorizador JWT."
  type        = string
}

variable "frontend_domain_url" {
  description = "Origen exacto del frontend autorizado por CORS en la API."
  type        = string
}

variable "log_retention_days" {
  description = "Dias de retencion de CloudWatch Logs para las Lambdas HTTP."
  type        = number
  default     = 14
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
