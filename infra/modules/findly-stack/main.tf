locals {
  # CloudFront no depende del API ni del bucket de cargas: este origen generado
  # puede alimentar CORS en el mismo apply sin crear una dependencia circular.
  frontend_origin = var.enable_web ? "https://${var.web_domain_name != "" ? var.web_domain_name : module.web[0].distribution_domain_name}" : var.frontend_domain_url
}

module "dynamodb" {
  source                        = "../dynamodb"
  table_name                    = "${var.project}-${var.environment}"
  project                       = var.project
  environment                   = var.environment
  cost_center                   = var.cost_center
  data_class                    = var.data_class
  enable_point_in_time_recovery = var.environment == "production"
}

module "uploads_bucket" {
  source              = "../uploads-bucket"
  bucket_name         = var.uploads_bucket_name
  frontend_domain_url = local.frontend_origin
  project             = var.project
  environment         = var.environment
  cost_center         = var.cost_center
  data_class          = var.data_class
  force_destroy       = var.allow_bucket_destroy
}

module "api_gateway" {
  source               = "../api-gateway"
  frontend_domain_url  = local.frontend_origin
  throttled_route_keys = [module.public_enrollment.telemetry_route_key]
  project              = var.project
  environment          = var.environment
  cost_center          = var.cost_center
  data_class           = var.data_class
}

module "cognito" {
  source         = "../cognito"
  user_pool_name = "${var.project}-${var.environment}-organizers"
  project        = var.project
  environment    = var.environment
  cost_center    = var.cost_center
  data_class     = var.data_class
}

module "admin_api" {
  source               = "../admin-api"
  api_id               = module.api_gateway.api_id
  api_execution_arn    = module.api_gateway.execution_arn
  table_name           = module.dynamodb.table_name
  table_arn            = module.dynamodb.table_arn
  uploads_bucket_name  = module.uploads_bucket.bucket_name
  uploads_bucket_arn   = module.uploads_bucket.bucket_arn
  user_pool_arn        = module.cognito.user_pool_arn
  user_pool_client_id  = module.cognito.client_id
  user_pool_issuer_url = module.cognito.issuer_url
  lambda_artifact_path = "${path.module}/../../../artifacts/lambdas/adminEvents.zip"
  project              = var.project
  environment          = var.environment
  cost_center          = var.cost_center
  data_class           = var.data_class
}

module "gallery_reader" {
  source               = "../gallery-reader"
  api_id               = module.api_gateway.api_id
  api_execution_arn    = module.api_gateway.execution_arn
  table_name           = module.dynamodb.table_name
  table_arn            = module.dynamodb.table_arn
  uploads_bucket_name  = module.uploads_bucket.bucket_name
  uploads_bucket_arn   = module.uploads_bucket.bucket_arn
  lambda_artifact_path = coalesce(var.gallery_lambda_artifact_path, "${path.module}/../../../artifacts/lambdas/gallery.zip")
  frontend_domain_url  = local.frontend_origin
  project              = var.project
  environment          = var.environment
  cost_center          = var.cost_center
  data_class           = var.data_class
}

module "monitoring" {
  source           = "../monitoring"
  alert_email      = var.alert_email
  budget_limit_usd = var.budget_limit_usd
  enable_budget    = var.enable_budget
  project          = var.project
  environment      = var.environment
  cost_center      = var.cost_center
  data_class       = var.data_class
}

module "photo_matching" {
  selfie_indexer_arn   = module.selfie_indexer.lambda_arn
  depends_on           = [module.selfie_indexer]
  source               = "../photo-matching"
  table_name           = module.dynamodb.table_name
  table_arn            = module.dynamodb.table_arn
  uploads_bucket_id    = module.uploads_bucket.bucket_name
  uploads_bucket_arn   = module.uploads_bucket.bucket_arn
  lambda_artifact_path = "${path.module}/../../../artifacts/lambdas/photoMatcher.zip"
  dlq_alarm_actions    = [module.monitoring.alerts_topic_arn]
  project              = var.project
  environment          = var.environment
  cost_center          = var.cost_center
  data_class           = var.data_class
}

module "web" {
  count               = var.enable_web ? 1 : 0
  source              = "../cloudfront"
  bucket_name         = var.web_bucket_name
  custom_domain_name  = var.web_domain_name
  acm_certificate_arn = var.web_certificate_arn
  project             = var.project
  environment         = var.environment
  cost_center         = var.cost_center
  data_class          = "public"
}

module "delete_registration" {
  source               = "../delete-registration"
  table_name           = module.dynamodb.table_name
  table_arn            = module.dynamodb.table_arn
  uploads_bucket_name  = module.uploads_bucket.bucket_name
  uploads_bucket_arn   = module.uploads_bucket.bucket_arn
  lambda_artifact_path = "${path.module}/../../../artifacts/lambdas/deleteRegistration.zip"
  project              = var.project
  environment          = var.environment
  cost_center          = var.cost_center
  data_class           = var.data_class
  api_id               = module.api_gateway.api_id
  api_execution_arn    = module.api_gateway.execution_arn
}

module "retention_purger" {
  source               = "../retention-purger"
  table_name           = module.dynamodb.table_name
  table_arn            = module.dynamodb.table_arn
  uploads_bucket_name  = module.uploads_bucket.bucket_name
  uploads_bucket_arn   = module.uploads_bucket.bucket_arn
  lambda_artifact_path = "${path.module}/../../../artifacts/lambdas/retentionPurger.zip"
  project              = var.project
  environment          = var.environment
  cost_center          = var.cost_center
  data_class           = var.data_class
}

module "public_enrollment" {
  source                          = "../public-enrollment"
  api_id                          = module.api_gateway.api_id
  api_execution_arn               = module.api_gateway.execution_arn
  table_name                      = module.dynamodb.table_name
  table_arn                       = module.dynamodb.table_arn
  uploads_bucket_name             = module.uploads_bucket.bucket_name
  uploads_bucket_arn              = module.uploads_bucket.bucket_arn
  public_events_artifact_path     = "${path.module}/../../../artifacts/lambdas/publicEvents.zip"
  public_enrollment_artifact_path = "${path.module}/../../../artifacts/lambdas/publicEnrollment.zip"
  project                         = var.project
  environment                     = var.environment
  cost_center                     = var.cost_center
  data_class                      = var.data_class
}
module "selfie_indexer" {
  uploads_bucket_name  = module.uploads_bucket.bucket_name
  source               = "../selfie-indexer"
  table_name           = module.dynamodb.table_name
  table_arn            = module.dynamodb.table_arn
  uploads_bucket_arn   = module.uploads_bucket.bucket_arn
  lambda_artifact_path = "${path.module}/../../../artifacts/lambdas/selfieIndexer.zip"
  project              = var.project
  environment          = var.environment
  cost_center          = var.cost_center
  data_class           = var.data_class
}
