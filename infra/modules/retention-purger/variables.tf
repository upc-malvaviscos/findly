variable "table_name" {
  description = "Nombre de la tabla DynamoDB de tabla unica (findly-{env})."
  type        = string
}

variable "table_arn" {
  description = "ARN de la tabla DynamoDB, usado para permisos IAM de minimo privilegio."
  type        = string
}

variable "uploads_bucket_name" {
  description = "Nombre del bucket S3 de subidas (infra/modules/uploads-bucket) que contiene selfies y fotos de evento."
  type        = string
}

variable "uploads_bucket_arn" {
  description = "ARN del bucket S3 de subidas, usado para permisos IAM."
  type        = string
}

variable "lambda_artifact_path" {
  description = "Ruta al zip empaquetado de la Lambda RetentionPurger (artifacts/lambdas/retentionPurger.zip)."
  type        = string
}

variable "schedule_expression" {
  description = "Expresion cron de EventBridge Scheduler para la purga diaria."
  type        = string
  default     = "cron(0 3 * * ? *)"
}

variable "log_retention_days" {
  description = "Dias de retencion de CloudWatch Logs para la Lambda RetentionPurger."
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
