data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0, < 7.0"
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
  prefix                     = "${var.project}-${var.environment}"
  lambda_timeout_seconds     = 60
  sqs_visibility_timeout     = 360 # >= 6x lambda_timeout_seconds, same ratio as photo-matching (spec 07 pitfall)
  queue_name                 = "${local.prefix}-backfill-queue"
  dlq_name                   = "${local.prefix}-backfill-dlq"
  function_name              = "${local.prefix}-registration-backfill"
  rekognition_collection_arn = "arn:aws:rekognition:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:collection/${var.project}-${var.environment}-event-*"
}

resource "aws_sqs_queue" "backfill_dlq" {
  name = local.dlq_name
  tags = local.tags
}

resource "aws_sqs_queue" "backfill" {
  name                       = local.queue_name
  visibility_timeout_seconds = local.sqs_visibility_timeout
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.backfill_dlq.arn
    maxReceiveCount     = 3
  })
  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "backfill_dlq_has_messages" {
  alarm_name          = "${local.dlq_name}-has-messages"
  alarm_description   = "Mensajes en la DLQ de backfill tras 3 recepciones fallidas de RegistrationBackfill."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.backfill_dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.dlq_alarm_actions
  tags                = local.tags
}

resource "aws_cloudwatch_log_group" "registration_backfill" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_iam_role" "registration_backfill" {
  permissions_boundary = var.permissions_boundary_arn
  name                 = "${local.function_name}-role"
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

resource "aws_iam_role_policy" "registration_backfill" {
  name = "${local.function_name}-policy"
  role = aws_iam_role.registration_backfill.id
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
        Resource = "${aws_cloudwatch_log_group.registration_backfill.arn}:*"
      },
      {
        Sid    = "ConsumeAndContinueBackfillQueue"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:SendMessage",
        ]
        Resource = aws_sqs_queue.backfill.arn
      },
      {
        Sid      = "ReadEventPhotos"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${var.uploads_bucket_arn}/events/*/photos/*"
      },
      {
        Sid    = "RekognitionFaceMatching"
        Effect = "Allow"
        Action = [
          "rekognition:IndexFaces",
          "rekognition:SearchFaces",
          "rekognition:DeleteFaces",
        ]
        Resource = local.rekognition_collection_arn
      },
      {
        Sid      = "ReadRegistration"
        Effect   = "Allow"
        Action   = "dynamodb:GetItem"
        Resource = var.table_arn
      },
      {
        Sid      = "ListEventPhotos"
        Effect   = "Allow"
        Action   = "dynamodb:Query"
        Resource = var.table_arn
      },
      {
        Sid      = "WriteMatches"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:ConditionCheckItem"]
        Resource = var.table_arn
      },
      {
        Sid      = "QueryFaceIndex"
        Effect   = "Allow"
        Action   = "dynamodb:Query"
        Resource = "${var.table_arn}/index/GSI1"
      },
    ]
  })
}

resource "aws_lambda_function" "registration_backfill" {
  function_name    = local.function_name
  role             = aws_iam_role.registration_backfill.arn
  handler          = "registrationBackfill.registrationBackfill"
  runtime          = "nodejs24.x"
  memory_size      = 512
  timeout          = local.lambda_timeout_seconds
  filename         = var.lambda_artifact_path
  source_code_hash = filebase64sha256(var.lambda_artifact_path)

  environment {
    variables = {
      FINDLY_TABLE_NAME           = var.table_name
      FINDLY_COLLECTION_NAMESPACE = "${var.project}-${var.environment}"
      FINDLY_PHOTO_BUCKET         = var.uploads_bucket_name
      FINDLY_BACKFILL_QUEUE_URL   = aws_sqs_queue.backfill.url
    }
  }

  depends_on = [aws_cloudwatch_log_group.registration_backfill]
  tags       = local.tags
}

resource "aws_lambda_event_source_mapping" "backfill" {
  event_source_arn        = aws_sqs_queue.backfill.arn
  function_name           = aws_lambda_function.registration_backfill.arn
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
  tags                    = local.tags
}
