terraform {
  required_version = ">= 1.14.0, < 2.0.0"

  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0, < 6.0"
    }
  }
}

locals {
  environment = "pr-${var.pull_request_number}"
  tags = {
    Project     = "findly"
    Environment = local.environment
    ManagedBy   = "Terraform"
    CostCenter  = "findly-ci"
    DataClass   = "synthetic"
    Ephemeral   = "true"
    PullRequest = tostring(var.pull_request_number)
  }
}

provider "aws" {
  region = var.aws_region

  default_tags { tags = local.tags }
}

module "dynamodb" {
  source                        = "../modules/dynamodb"
  table_name                    = "findly-${local.environment}"
  project                       = "findly"
  environment                   = local.environment
  cost_center                   = "findly-ci"
  data_class                    = "synthetic"
  enable_point_in_time_recovery = false
}

module "uploads_bucket" {
  source              = "../modules/uploads-bucket"
  bucket_name         = "findly-pr-${var.pull_request_number}-${var.aws_account_id}-${var.aws_region}"
  frontend_domain_url = var.frontend_domain_url
  project             = "findly"
  environment         = local.environment
  cost_center         = "findly-ci"
  data_class          = "synthetic"
  force_destroy       = true
}

module "api_gateway" {
  source              = "../modules/api-gateway"
  frontend_domain_url = var.frontend_domain_url
  project             = "findly"
  environment         = local.environment
  cost_center         = "findly-ci"
  data_class          = "synthetic"
}

module "cognito" {
  source         = "../modules/cognito"
  user_pool_name = "findly-${local.environment}-organizers"
  project        = "findly"
  environment    = local.environment
  cost_center    = "findly-ci"
  data_class     = "synthetic"
}

module "admin_api" {
  source               = "../modules/admin-api"
  api_id               = module.api_gateway.api_id
  api_execution_arn    = module.api_gateway.execution_arn
  table_name           = module.dynamodb.table_name
  table_arn            = module.dynamodb.table_arn
  uploads_bucket_name  = module.uploads_bucket.bucket_name
  uploads_bucket_arn   = module.uploads_bucket.bucket_arn
  user_pool_arn        = module.cognito.user_pool_arn
  user_pool_client_id  = module.cognito.client_id
  user_pool_issuer_url = module.cognito.issuer_url
  lambda_artifact_path = "../../artifacts/lambdas/adminEvents.zip"
  project              = "findly"
  environment          = local.environment
  cost_center          = "findly-ci"
  data_class           = "synthetic"
}

module "gallery_reader" {
  source               = "../modules/gallery-reader"
  api_id               = module.api_gateway.api_id
  api_execution_arn    = module.api_gateway.execution_arn
  table_name           = module.dynamodb.table_name
  table_arn            = module.dynamodb.table_arn
  uploads_bucket_name  = module.uploads_bucket.bucket_name
  uploads_bucket_arn   = module.uploads_bucket.bucket_arn
  lambda_artifact_path = "../../artifacts/lambdas/gallery.zip"
  frontend_domain_url  = var.frontend_domain_url
  project              = "findly"
  environment          = local.environment
  cost_center          = "findly-ci"
  data_class           = "synthetic"
}
