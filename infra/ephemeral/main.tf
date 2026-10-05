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
  source               = "../modules/api-gateway"
  frontend_domain_url  = var.frontend_domain_url
  throttled_route_keys = [module.public_enrollment.telemetry_route_key]
  project              = "findly"
  environment          = local.environment
  cost_center          = "findly-ci"
  data_class           = "synthetic"
}

module "cognito" {
  admin_login_url = "${var.frontend_domain_url}/admin/login"
  source          = "../modules/cognito"
  user_pool_name  = "findly-${local.environment}-organizers"
  project         = "findly"
  environment     = local.environment
  cost_center     = "findly-ci"
  data_class      = "synthetic"
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

module "delete_registration" {
  source               = "../modules/delete-registration"
  table_name           = module.dynamodb.table_name
  table_arn            = module.dynamodb.table_arn
  uploads_bucket_name  = module.uploads_bucket.bucket_name
  uploads_bucket_arn   = module.uploads_bucket.bucket_arn
  lambda_artifact_path = "../../artifacts/lambdas/deleteRegistration.zip"
  project              = "findly"
  environment          = local.environment
  cost_center          = "findly-ci"
  data_class           = "synthetic"
  api_id               = module.api_gateway.api_id
  api_execution_arn    = module.api_gateway.execution_arn
}

module "retention_purger" {
  source               = "../modules/retention-purger"
  table_name           = module.dynamodb.table_name
  table_arn            = module.dynamodb.table_arn
  uploads_bucket_name  = module.uploads_bucket.bucket_name
  uploads_bucket_arn   = module.uploads_bucket.bucket_arn
  lambda_artifact_path = "../../artifacts/lambdas/retentionPurger.zip"
  project              = "findly"
  environment          = local.environment
  cost_center          = "findly-ci"
  data_class           = "synthetic"
}

module "monitoring" {
  source        = "../modules/monitoring"
  project       = "findly"
  environment   = local.environment
  cost_center   = "findly-ci"
  data_class    = "synthetic"
  enable_budget = false
}

resource "aws_sqs_queue" "alert_probe" {
  name                      = "findly-${local.environment}-alert-probe"
  message_retention_seconds = 3600
  tags                      = local.tags
}
resource "aws_sqs_queue_policy" "alert_probe" {
  queue_url = aws_sqs_queue.alert_probe.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "sns.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.alert_probe.arn
      Condition = { ArnEquals = { "aws:SourceArn" = module.monitoring.alerts_topic_arn } }
    }]
  })
}
resource "aws_sns_topic_subscription" "alert_probe" {
  topic_arn            = module.monitoring.alerts_topic_arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.alert_probe.arn
  raw_message_delivery = false
  depends_on           = [aws_sqs_queue_policy.alert_probe]
}

module "photo_matching" {
  selfie_indexer_arn   = module.selfie_indexer.lambda_arn
  depends_on           = [module.selfie_indexer]
  source               = "../modules/photo-matching"
  table_name           = module.dynamodb.table_name
  table_arn            = module.dynamodb.table_arn
  uploads_bucket_id    = module.uploads_bucket.bucket_name
  uploads_bucket_arn   = module.uploads_bucket.bucket_arn
  lambda_artifact_path = "../../artifacts/lambdas/photoMatcher.zip"
  dlq_alarm_actions    = [module.monitoring.alerts_topic_arn]
  project              = "findly"
  environment          = local.environment
  cost_center          = "findly-ci"
  data_class           = "synthetic"
}

module "public_enrollment" {
  source                          = "../modules/public-enrollment"
  api_id                          = module.api_gateway.api_id
  api_execution_arn               = module.api_gateway.execution_arn
  table_name                      = module.dynamodb.table_name
  table_arn                       = module.dynamodb.table_arn
  uploads_bucket_name             = module.uploads_bucket.bucket_name
  uploads_bucket_arn              = module.uploads_bucket.bucket_arn
  public_events_artifact_path     = "../../artifacts/lambdas/publicEvents.zip"
  public_enrollment_artifact_path = "../../artifacts/lambdas/publicEnrollment.zip"
  project                         = "findly"
  environment                     = local.environment
  cost_center                     = "findly-ci"
  data_class                      = "synthetic"
}
module "selfie_indexer" {
  uploads_bucket_name  = module.uploads_bucket.bucket_name
  source               = "../modules/selfie-indexer"
  table_name           = module.dynamodb.table_name
  table_arn            = module.dynamodb.table_arn
  uploads_bucket_arn   = module.uploads_bucket.bucket_arn
  lambda_artifact_path = "../../artifacts/lambdas/selfieIndexer.zip"
  project              = "findly"
  environment          = local.environment
  cost_center          = "findly-ci"
  data_class           = "synthetic"
}
