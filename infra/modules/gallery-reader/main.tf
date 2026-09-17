terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0, < 6.0"
    }
  }
}

locals {
  function_name = "${var.project}-${var.environment}-gallery-reader"
  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "Terraform"
    CostCenter  = var.cost_center
    DataClass   = var.data_class
  }
}

resource "aws_cloudwatch_log_group" "gallery_reader" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_iam_role" "gallery_reader" {
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

resource "aws_iam_role_policy" "gallery_reader" {
  name = "${local.function_name}-policy"
  role = aws_iam_role.gallery_reader.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "WriteStructuredLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.gallery_reader.arn}:*"
      },
      {
        Sid      = "ReadGalleryRecords"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:Query"]
        Resource = var.table_arn
      },
      {
        Sid      = "ReadMatchedPhotos"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${var.uploads_bucket_arn}/events/*/photos/*"
      },
    ]
  })
}

resource "aws_lambda_function" "gallery_reader" {
  function_name    = local.function_name
  role             = aws_iam_role.gallery_reader.arn
  handler          = "gallery.gallery"
  runtime          = "nodejs22.x"
  memory_size      = 256
  timeout          = 5
  filename         = var.lambda_artifact_path
  source_code_hash = filebase64sha256(var.lambda_artifact_path)

  environment {
    variables = {
      CORS_ORIGIN         = var.frontend_domain_url
      FINDLY_PHOTO_BUCKET = var.uploads_bucket_name
      FINDLY_TABLE_NAME   = var.table_name
    }
  }

  depends_on = [aws_cloudwatch_log_group.gallery_reader]
  tags       = local.tags
}

resource "aws_apigatewayv2_integration" "gallery_reader" {
  api_id                 = var.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.gallery_reader.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "gallery" {
  api_id    = var.api_id
  route_key = "GET /gallery"
  target    = "integrations/${aws_apigatewayv2_integration.gallery_reader.id}"
}

resource "aws_lambda_permission" "allow_api_gateway" {
  statement_id  = "AllowHttpApiGetGallery"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.gallery_reader.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*/GET/gallery"
}
