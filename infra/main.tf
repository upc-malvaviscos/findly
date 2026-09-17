terraform {
  required_version = ">= 1.14.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0, < 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "Terraform"
      CostCenter  = var.cost_center
      DataClass   = var.data_class
    }
  }
}

module "dynamodb" {
  source                        = "./modules/dynamodb"
  table_name                    = "${var.project}-${var.environment}"
  project                       = var.project
  environment                   = var.environment
  cost_center                   = var.cost_center
  data_class                    = var.data_class
  enable_point_in_time_recovery = var.environment == "production"
}

module "uploads_bucket" {
  source              = "./modules/uploads-bucket"
  bucket_name         = var.uploads_bucket_name
  frontend_domain_url = var.frontend_domain_url
  project             = var.project
  environment         = var.environment
  cost_center         = var.cost_center
  data_class          = var.data_class
}

module "api_gateway" {
  source              = "./modules/api-gateway"
  frontend_domain_url = var.frontend_domain_url
  project             = var.project
  environment         = var.environment
  cost_center         = var.cost_center
  data_class          = var.data_class
}
