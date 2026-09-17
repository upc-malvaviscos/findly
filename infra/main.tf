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

module "cognito" {
  source         = "./modules/cognito"
  user_pool_name = "${var.project}-${var.environment}-organizers"
  project        = var.project
  environment    = var.environment
  cost_center    = var.cost_center
  data_class     = var.data_class
}

module "admin_api" {
  source               = "./modules/admin-api"
  api_id               = module.api_gateway.api_id
  api_execution_arn    = module.api_gateway.execution_arn
  table_name           = module.dynamodb.table_name
  table_arn            = module.dynamodb.table_arn
  uploads_bucket_name  = module.uploads_bucket.bucket_name
  uploads_bucket_arn   = module.uploads_bucket.bucket_arn
  user_pool_arn        = module.cognito.user_pool_arn
  user_pool_client_id  = module.cognito.client_id
  user_pool_issuer_url = module.cognito.issuer_url
  lambda_artifact_path = "${path.module}/../artifacts/lambdas/adminEvents.zip"
  project              = var.project
  environment          = var.environment
  cost_center          = var.cost_center
  data_class           = var.data_class
}

module "gallery_reader" {
  source               = "./modules/gallery-reader"
  api_id               = module.api_gateway.api_id
  api_execution_arn    = module.api_gateway.execution_arn
  table_name           = module.dynamodb.table_name
  table_arn            = module.dynamodb.table_arn
  uploads_bucket_name  = module.uploads_bucket.bucket_name
  uploads_bucket_arn   = module.uploads_bucket.bucket_arn
  lambda_artifact_path = var.gallery_lambda_artifact_path
  frontend_domain_url  = var.frontend_domain_url
  project              = var.project
  environment          = var.environment
  cost_center          = var.cost_center
  data_class           = var.data_class
}
