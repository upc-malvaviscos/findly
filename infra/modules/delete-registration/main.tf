data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0, < 7.0"
    }
  }
}

locals {
  function_name = "${var.project}-${var.environment}-delete-registration"
  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "Terraform"
    CostCenter  = var.cost_center
    DataClass   = var.data_class
  }
}

resource "aws_cloudwatch_log_group" "delete_registration" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_iam_role" "delete_registration" {
  name = "${local.function_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "delete_registration" {
  name = "${local.function_name}-policy"
  role = aws_iam_role.delete_registration.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "WriteStructuredLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.delete_registration.arn}:*"
      },
      {
        Sid      = "EraseRegistrationRecords"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:DeleteItem", "dynamodb:UpdateItem"]
        Resource = var.table_arn
      },
      {
        Sid      = "DeleteRegistrationSelfie"
        Effect   = "Allow"
        Action   = "s3:DeleteObject"
        Resource = "${var.uploads_bucket_arn}/events/*/selfies/*"
      },
      {
        Sid      = "DeleteRegistrationFace"
        Effect   = "Allow"
        Action   = "rekognition:DeleteFaces"
        Resource = "arn:aws:rekognition:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:collection/findly-event-*"
      },
    ]
  })
}

resource "aws_lambda_function" "delete_registration" {
  function_name    = local.function_name
  role             = aws_iam_role.delete_registration.arn
  handler          = "deleteRegistration.deleteRegistration"
  runtime          = "nodejs22.x"
  memory_size      = 256
  timeout          = 30
  filename         = var.lambda_artifact_path
  source_code_hash = filebase64sha256(var.lambda_artifact_path)

  environment {
    variables = {
      FINDLY_SELFIE_BUCKET = var.uploads_bucket_name
      FINDLY_TABLE_NAME    = var.table_name
    }
  }

  depends_on = [aws_cloudwatch_log_group.delete_registration]
  tags       = local.tags
}

resource "aws_apigatewayv2_integration" "delete_registration" {
  api_id                 = var.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.delete_registration.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "erasure" {
  api_id    = var.api_id
  route_key = "DELETE /registrations/{registrationId}"
  target    = "integrations/${aws_apigatewayv2_integration.delete_registration.id}"
}

resource "aws_lambda_permission" "allow_api_gateway" {
  statement_id  = "AllowHttpApiDeleteRegistration"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.delete_registration.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*/DELETE/registrations/*"
}
