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
provider "aws" { region = "eu-west-1" }
resource "aws_sesv2_email_identity" "findly" {
  email_identity = "findly.barcelona"
  tags           = { Project = "findly", Environment = "shared", ManagedBy = "Terraform", CostCenter = "findly", DataClass = "public" }
  lifecycle { prevent_destroy = true }
}
resource "aws_sesv2_email_identity_mail_from_attributes" "findly" {
  email_identity         = aws_sesv2_email_identity.findly.email_identity
  mail_from_domain       = "bounce.findly.barcelona"
  behavior_on_mx_failure = "REJECT_MESSAGE"
}
output "identity_arn" {
  description = "Pass to the environment email_identity_arn only after DNS and production-access checks."
  value       = aws_sesv2_email_identity.findly.arn
}
output "dkim_records" {
  description = "Public DNS records to add in Acens."
  value       = [for token in aws_sesv2_email_identity.findly.dkim_signing_attributes[0].tokens : { name = "${token}._domainkey.findly.barcelona", type = "CNAME", value = "${token}.dkim.amazonses.com" }]
}
output "mail_from_records" {
  description = "Public MX and SPF records for the dedicated MAIL FROM subdomain, not the receiving mailbox."
  value = [
    { name = "bounce.findly.barcelona", type = "MX", value = "10 feedback-smtp.eu-west-1.amazonses.com" },
    { name = "bounce.findly.barcelona", type = "TXT", value = "v=spf1 include:amazonses.com ~all" }
  ]
}
