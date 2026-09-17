variable "aws_region" {
  description = "Region where the PR-only stack is created."
  type        = string
  default     = "eu-west-1"
}

variable "aws_account_id" {
  description = "AWS account ID used solely to make the ephemeral bucket name unique."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a 12-digit AWS account ID."
  }
}

variable "pull_request_number" {
  description = "GitHub pull request number. This root refuses non-PR environments."
  type        = number

  validation {
    condition     = var.pull_request_number > 0 && floor(var.pull_request_number) == var.pull_request_number
    error_message = "pull_request_number must be a positive integer."
  }
}

variable "frontend_domain_url" {
  description = "Exact CI browser origin allowed by API Gateway and S3 CORS."
  type        = string
  default     = "http://127.0.0.1:4173"
}
