terraform {
  required_version = ">= 1.14.0, < 2.0.0"

  # Backend parcial: bucket y región se pasan con -backend-config para no
  # versionar el ID de cuenta. Clave de estado exclusiva de este entorno:
  # findly/demo/terraform.tfstate. El bloqueo usa el lockfile nativo de S3
  # (use_lockfile=true); no hay tabla DynamoDB de bloqueo (ADR-009).
  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0, < 6.0"
    }
  }
}

locals {
  # Fijado en el root: un tfvars no puede apuntar este estado a otro entorno.
  environment = "demo"
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project
      Environment = local.environment
      ManagedBy   = "Terraform"
      CostCenter  = var.cost_center
      DataClass   = var.data_class
    }
  }
}

module "findly" {
  source               = "../../modules/findly-stack"
  aws_region           = var.aws_region
  project              = var.project
  environment          = local.environment
  cost_center          = var.cost_center
  data_class           = var.data_class
  frontend_domain_url  = var.frontend_domain_url
  uploads_bucket_name  = var.uploads_bucket_name
  allow_bucket_destroy = false
}
