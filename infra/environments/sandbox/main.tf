terraform {
  required_version = ">= 1.14.0, < 2.0.0"

  # Backend parcial: bucket y región se pasan con -backend-config para no
  # versionar el ID de cuenta. Clave de estado exclusiva de este entorno:
  # findly/sandbox/terraform.tfstate. El bloqueo usa el lockfile nativo de S3
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
  environment = "sandbox"
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
  allow_bucket_destroy = true
}

# El estado sandbox existente se creó con estos módulos en la raíz; `moved`
# los reubica bajo module.findly sin destruir ni recrear recursos.
moved {
  from = module.dynamodb
  to   = module.findly.module.dynamodb
}

moved {
  from = module.uploads_bucket
  to   = module.findly.module.uploads_bucket
}

moved {
  from = module.api_gateway
  to   = module.findly.module.api_gateway
}

moved {
  from = module.cognito
  to   = module.findly.module.cognito
}

moved {
  from = module.admin_api
  to   = module.findly.module.admin_api
}

moved {
  from = module.gallery_reader
  to   = module.findly.module.gallery_reader
}
