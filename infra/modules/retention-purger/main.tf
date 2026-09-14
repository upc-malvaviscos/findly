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
  function_name = "findly-retention-purger"
  # La spec 09 no fija memoria/timeout para esta Lambda (a diferencia de
  # SelfieIndexer y PhotoMatcher, que si los especifican). Valores propios
  # razonables para un cron por lotes sin presion de latencia de usuario.
  lambda_memory_mb           = 512
  lambda_timeout_seconds     = 300
  rekognition_collection_arn = "arn:aws:rekognition:*:*:collection/findly-event-*"
}

resource "aws_cloudwatch_log_group" "retention_purger" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_iam_role" "retention_purger" {
  name = "${local.function_name}-role"
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

resource "aws_iam_role_policy" "retention_purger" {
  name = "${local.function_name}-policy"
  role = aws_iam_role.retention_purger.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Logs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "${aws_cloudwatch_log_group.retention_purger.arn}:*"
      },
      {
        Sid      = "ScanEvents"
        Effect   = "Allow"
        Action   = "dynamodb:Scan"
        Resource = var.table_arn
      },
      {
        Sid      = "PurgeFaceCollections"
        Effect   = "Allow"
        Action   = "rekognition:DeleteCollection"
        Resource = local.rekognition_collection_arn
      },
      {
        Sid      = "ListExpiredEventObjects"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = var.uploads_bucket_arn
        Condition = {
          StringLike = { "s3:prefix" = "events/*" }
        }
      },
      {
        Sid      = "DeleteExpiredEventObjects"
        Effect   = "Allow"
        Action   = "s3:DeleteObject"
        Resource = "${var.uploads_bucket_arn}/events/*"
      },
    ]
  })
}

resource "aws_lambda_function" "retention_purger" {
  function_name    = local.function_name
  role             = aws_iam_role.retention_purger.arn
  handler          = "retentionPurger.retentionPurger"
  runtime          = "nodejs22.x" # runtime AWS Lambda gestionado; el tooling local usa Node 24 (ver README)
  memory_size      = local.lambda_memory_mb
  timeout          = local.lambda_timeout_seconds
  filename         = var.lambda_artifact_path
  source_code_hash = filebase64sha256(var.lambda_artifact_path)

  environment {
    variables = {
      FINDLY_TABLE_NAME     = var.table_name
      FINDLY_UPLOADS_BUCKET = var.uploads_bucket_name
    }
  }

  tags = local.tags
}

resource "aws_iam_role" "scheduler" {
  name = "${local.function_name}-scheduler-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "scheduler.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
  tags = local.tags
}

resource "aws_iam_role_policy" "scheduler" {
  name = "${local.function_name}-scheduler-policy"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "InvokeRetentionPurger"
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = aws_lambda_function.retention_purger.arn
      }
    ]
  })
}

resource "aws_scheduler_schedule" "retention_purger" {
  name                = local.function_name
  schedule_expression = var.schedule_expression

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.retention_purger.arn
    role_arn = aws_iam_role.scheduler.arn
  }
}
