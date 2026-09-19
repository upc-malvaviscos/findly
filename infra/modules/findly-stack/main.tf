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
  frontend_domain_url = var.frontend_domain_url
  project             = var.project
  environment         = var.environment
  cost_center         = var.cost_center
  data_class          = var.data_class
  force_destroy       = var.allow_bucket_destroy
}

module "api_gateway" {
  source              = "../api-gateway"
  frontend_domain_url = var.frontend_domain_url
  project             = var.project
  environment         = var.environment
  cost_center         = var.cost_center
  data_class          = var.data_class
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
  frontend_domain_url  = var.frontend_domain_url
  project              = var.project
  environment          = var.environment
  cost_center          = var.cost_center
  data_class           = var.data_class
}
