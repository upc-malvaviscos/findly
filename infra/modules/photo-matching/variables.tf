variable "table_name" {
  description = "Nombre de la tabla DynamoDB de tabla unica (findly-{env})."
  type        = string
}

variable "table_arn" {
  description = "ARN de la tabla DynamoDB, usado para permisos IAM de minimo privilegio."
  type        = string
}

variable "uploads_bucket_id" {
  description = "Id del bucket S3 de subidas (infra/modules/uploads-bucket) que contiene selfies y fotos de evento."
  type        = string
}

variable "uploads_bucket_arn" {
  description = "ARN del bucket S3 de subidas, usado para permisos IAM y la politica de la cola SQS."
  type        = string
}

variable "lambda_artifact_path" {
  description = "Ruta al zip empaquetado de la Lambda PhotoMatcher (artifacts/lambdas/photoMatcher.zip)."
  type        = string
}

variable "log_retention_days" {
  description = "Dias de retencion de CloudWatch Logs para la Lambda PhotoMatcher."
  type        = number
  default     = 14
}

variable "dlq_alarm_actions" {
  description = "ARNs de notificacion (p.ej. SNS) para la alarma de mensajes en la DLQ. Vacio por defecto: ninguna spec define aun un destino de alertas."
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
