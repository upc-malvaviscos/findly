variable "table_name" {
  description = "Nombre de la tabla DynamoDB de tabla unica (findly-{env})."
  type        = string
}

variable "table_arn" {
  description = "ARN de la tabla DynamoDB, usado para permisos IAM de minimo privilegio."
  type        = string
}

variable "uploads_bucket_name" {
  description = "Nombre del bucket S3 de subidas (infra/modules/uploads-bucket); fuente de FINDLY_PHOTO_BUCKET."
  type        = string
}

variable "uploads_bucket_arn" {
  description = "ARN del bucket S3 de subidas, usado para permisos IAM de lectura de fotos."
  type        = string
}

variable "lambda_artifact_path" {
  description = "Ruta al zip empaquetado de la Lambda RegistrationBackfill (artifacts/lambdas/registrationBackfill.zip)."
  type        = string
}

variable "log_retention_days" {
  description = "Dias de retencion de CloudWatch Logs para la Lambda RegistrationBackfill."
  type        = number
  default     = 14
}

variable "dlq_alarm_actions" {
  description = "ARNs de notificacion (el topic SNS del modulo monitoring) para la alarma de mensajes en la DLQ. Vacio = la alarma existe pero no avisa a nadie."
  type        = list(string)
  default     = []
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

variable "permissions_boundary_arn" {
  description = "Optional runtime permissions ceiling; mandatory for the production stack."
  type        = string
  default     = null
}
