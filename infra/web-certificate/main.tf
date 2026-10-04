terraform {
  required_version = ">= 1.14.0, < 2.0.0"
  backend "s3" {}
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0, < 7.0"
    }
  }
}
provider "aws" { region = "us-east-1" }
resource "aws_acm_certificate" "web" {
  domain_name       = "www.findly.barcelona"
  validation_method = "DNS"
  tags              = { Project = "findly", Environment = "shared", ManagedBy = "Terraform", CostCenter = "findly", DataClass = "public" }
  lifecycle { prevent_destroy = true }
}
output "certificate_arn" {
  description = "Use only after ACM reports ISSUED."
  value       = aws_acm_certificate.web.arn
}
output "validation_records" {
  description = "Public CNAME records to add in Acens and retain for renewal."
  value       = [for record in aws_acm_certificate.web.domain_validation_options : { name = record.resource_record_name, type = record.resource_record_type, value = record.resource_record_value }]
}
