terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0, < 6.0"
    }
  }
}

locals {
  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "Terraform"
    CostCenter  = var.cost_center
    DataClass   = var.data_class
  }
  rekognition_collection_arn = "arn:aws:rekognition:*:*:collection/findly-event-*"
}

resource "aws_apigatewayv2_api" "http_api" {
  name          = "findly-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = [var.frontend_domain_url]
    allow_methods = ["GET", "POST", "DELETE"]
    allow_headers = ["content-type", "authorization", "x-gallery-token"]
    max_age       = 300
  }

  tags = local.tags
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http_api.id
  name        = "$default"
  auto_deploy = true
  tags        = local.tags
}

# Definido para que la issue #5 (administracion) lo referencie en sus
# rutas /admin/* al implementar los handlers reales; ninguna ruta lo usa
# todavia porque esos handlers no existen aun.
resource "aws_apigatewayv2_authorizer" "cognito_jwt" {
  api_id           = aws_apigatewayv2_api.http_api.id
  name             = "findly-cognito-jwt"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    audience = [var.cognito_client_id]
    issuer   = var.cognito_issuer_url
  }
}

# --- gallery (GET /gallery) --------------------------------------------

resource "aws_cloudwatch_log_group" "gallery" {
  name              = "/aws/lambda/findly-gallery"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_iam_role" "gallery" {
  name = "findly-gallery-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
  tags = local.tags
}

resource "aws_iam_role_policy" "gallery" {
  name = "findly-gallery-policy"
  role = aws_iam_role.gallery.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.gallery.arn}:*"
      },
      {
        Sid      = "ReadGalleryData"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:Query"]
        Resource = var.table_arn
      },
      {
        Sid      = "SignPhotoUrls"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${var.uploads_bucket_arn}/events/*/photos/*"
      },
    ]
  })
}

resource "aws_lambda_function" "gallery" {
  function_name    = "findly-gallery"
  role             = aws_iam_role.gallery.arn
  handler          = "gallery.gallery"
  runtime          = "nodejs22.x" # runtime AWS Lambda gestionado; el tooling local usa Node 24 (ver README)
  memory_size      = 256
  timeout          = 10
  filename         = var.gallery_artifact_path
  source_code_hash = filebase64sha256(var.gallery_artifact_path)

  environment {
    variables = {
      FINDLY_TABLE_NAME   = var.table_name
      FINDLY_PHOTO_BUCKET = var.uploads_bucket_name
      CORS_ORIGIN         = var.frontend_domain_url
    }
  }

  tags = local.tags
}

resource "aws_apigatewayv2_integration" "gallery" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.gallery.arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "gallery" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "GET /gallery"
  target    = "integrations/${aws_apigatewayv2_integration.gallery.id}"
}

resource "aws_lambda_permission" "gallery" {
  statement_id  = "AllowApiGatewayInvokeGallery"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.gallery.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/GET/gallery"
}

# --- deleteRegistration (DELETE /registrations/{registrationId}) -------

resource "aws_cloudwatch_log_group" "delete_registration" {
  name              = "/aws/lambda/findly-delete-registration"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_iam_role" "delete_registration" {
  name = "findly-delete-registration-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
  tags = local.tags
}

resource "aws_iam_role_policy" "delete_registration" {
  name = "findly-delete-registration-policy"
  role = aws_iam_role.delete_registration.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.delete_registration.arn}:*"
      },
      {
        Sid      = "ReadAndDeleteRegistrationData"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:DeleteItem"]
        Resource = var.table_arn
      },
      {
        Sid      = "DeleteFace"
        Effect   = "Allow"
        Action   = "rekognition:DeleteFaces"
        Resource = local.rekognition_collection_arn
      },
      {
        Sid      = "DeleteSelfie"
        Effect   = "Allow"
        Action   = "s3:DeleteObject"
        Resource = "${var.uploads_bucket_arn}/events/*/selfies/*"
      },
    ]
  })
}

resource "aws_lambda_function" "delete_registration" {
  function_name    = "findly-delete-registration"
  role             = aws_iam_role.delete_registration.arn
  handler          = "deleteRegistration.deleteRegistration"
  runtime          = "nodejs22.x" # runtime AWS Lambda gestionado; el tooling local usa Node 24 (ver README)
  memory_size      = 256
  timeout          = 10
  filename         = var.delete_registration_artifact_path
  source_code_hash = filebase64sha256(var.delete_registration_artifact_path)

  environment {
    variables = {
      FINDLY_TABLE_NAME    = var.table_name
      FINDLY_SELFIE_BUCKET = var.uploads_bucket_name
    }
  }

  tags = local.tags
}

resource "aws_apigatewayv2_integration" "delete_registration" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.delete_registration.arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "delete_registration" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "DELETE /registrations/{registrationId}"
  target    = "integrations/${aws_apigatewayv2_integration.delete_registration.id}"
}

resource "aws_lambda_permission" "delete_registration" {
  statement_id  = "AllowApiGatewayInvokeDeleteRegistration"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.delete_registration.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/DELETE/registrations/*"
}
