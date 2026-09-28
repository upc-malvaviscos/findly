terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 6.0, < 7.0" }
  }
}
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  prefix = "${var.project}-${var.environment}"
  tags   = { Project = var.project, Environment = var.environment, ManagedBy = "Terraform", CostCenter = var.cost_center, DataClass = var.data_class }
}
resource "aws_cloudwatch_log_group" "selfie" {
  name              = "/aws/lambda/${local.prefix}-selfie-indexer"
  retention_in_days = 14
  tags              = local.tags
}
resource "aws_iam_role" "selfie" {
  name               = "${local.prefix}-selfie-indexer"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
  tags               = local.tags
}
resource "aws_iam_role_policy" "selfie" {
  role = aws_iam_role.selfie.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.selfie.arn}:*" },
    { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:UpdateItem"], Resource = var.table_arn },
    { Effect = "Allow", Action = ["s3:GetObject"], Resource = "${var.uploads_bucket_arn}/events/*/selfies/*" },
    { Effect = "Allow", Action = ["rekognition:CreateCollection", "rekognition:TagResource", "rekognition:IndexFaces", "rekognition:DeleteFaces"], Resource = "arn:aws:rekognition:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:collection/findly-event-*" }
  ] })
}
resource "aws_lambda_function" "selfie" {
  function_name    = "${local.prefix}-selfie-indexer"
  role             = aws_iam_role.selfie.arn
  handler          = "selfieIndexer.selfieIndexer"
  runtime          = "nodejs24.x"
  memory_size      = 512
  timeout          = 10
  filename         = var.lambda_artifact_path
  source_code_hash = filebase64sha256(var.lambda_artifact_path)
  environment {
    variables = { FINDLY_TABLE_NAME = var.table_name, FINDLY_PROJECT = var.project, FINDLY_ENVIRONMENT = var.environment, FINDLY_COST_CENTER = var.cost_center, FINDLY_DATA_CLASS = var.data_class }
  }
  depends_on = [aws_cloudwatch_log_group.selfie]
  tags       = local.tags
}
resource "aws_lambda_permission" "s3" {
  statement_id   = "AllowSelfieBucket"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.selfie.function_name
  principal      = "s3.amazonaws.com"
  source_arn     = var.uploads_bucket_arn
  source_account = data.aws_caller_identity.current.account_id
}
