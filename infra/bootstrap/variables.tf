variable "aws_region" {
  description = "AWS region of the state bucket."
  type        = string
  default     = "eu-west-1"
}

variable "project" {
  description = "Project tag and bucket name prefix."
  type        = string
  default     = "findly"
}

variable "cost_center" {
  description = "CostCenter tag."
  type        = string
  default     = "findly"
}
