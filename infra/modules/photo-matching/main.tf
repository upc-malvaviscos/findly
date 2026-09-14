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
  lambda_timeout_seconds     = 30
  sqs_visibility_timeout     = 180 # >= 6x lambda_timeout_seconds, per spec 07's own pitfall
  queue_name                 = "findly-photos-queue"
  dlq_name                   = "findly-photos-dlq"
  function_name              = "findly-photo-matcher"
  rekognition_collection_arn = "arn:aws:rekognition:*:*:collection/findly-event-*"
}

resource "aws_sqs_queue" "photos_dlq" {
  name = local.dlq_name
  tags = local.tags
}

resource "aws_sqs_queue" "photos" {
  name                       = local.queue_name
  visibility_timeout_seconds = local.sqs_visibility_timeout
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.photos_dlq.arn
    maxReceiveCount     = 3
  })
  tags = local.tags
}

resource "aws_sqs_queue_policy" "photos" {
  queue_url = aws_sqs_queue.photos.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowS3EventNotifications"
        Effect    = "Allow"
        Principal = { Service = "s3.amazonaws.com" }
        Action    = "sqs:SendMessage"
        Resource  = aws_sqs_queue.photos.arn
        Condition = {
          ArnEquals = { "aws:SourceArn" = var.uploads_bucket_arn }
        }
      }
    ]
  })
}

resource "aws_cloudwatch_metric_alarm" "photos_dlq_has_messages" {
  alarm_name          = "${local.dlq_name}-has-messages"
  alarm_description   = "Mensajes en la DLQ de fotos tras 3 reintentos fallidos de PhotoMatcher."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.photos_dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.dlq_alarm_actions
  tags                = local.tags
}

# NOTA para la issue #7 (SelfieIndexer): este es el unico
# aws_s3_bucket_notification del bucket de subidas (selfies y fotos de
# evento comparten un unico bucket, decision tomada en la issue #6). Es un
# recurso singleton por bucket en Terraform/S3: una segunda declaracion
# independiente para el mismo bucket sobrescribiria esta configuracion en
# lugar de sumarse a ella. Cuando se implemente la issue #7, anade un
# bloque `lambda_function {}` adicional a ESTE recurso (en vez de crear uno
# nuevo) para su propio trigger de selfies. Ademas, dado que S3 solo filtra
# por prefix/suffix (no por segmento intermedio de la clave), ambos
# consumidores recibiran eventos de selfies Y de fotos; cada Lambda debe
# ignorar silenciosamente las claves que no le correspondan (PhotoMatcher
# ya lo hace via parseEventPhotoObjectKey).
resource "aws_s3_bucket_notification" "uploads" {
  bucket = var.uploads_bucket_id

  queue {
    queue_arn     = aws_sqs_queue.photos.arn
    events        = ["s3:ObjectCreated:Put"]
    filter_prefix = "events/"
    filter_suffix = ".jpg"
  }

  depends_on = [aws_sqs_queue_policy.photos]
}

resource "aws_cloudwatch_log_group" "photo_matcher" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_iam_role" "photo_matcher" {
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

resource "aws_iam_role_policy" "photo_matcher" {
  name = "${local.function_name}-policy"
  role = aws_iam_role.photo_matcher.id
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
        Resource = "${aws_cloudwatch_log_group.photo_matcher.arn}:*"
      },
      {
        Sid    = "ConsumePhotosQueue"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
        ]
        Resource = aws_sqs_queue.photos.arn
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
        Sid      = "WriteMatches"
        Effect   = "Allow"
        Action   = "dynamodb:PutItem"
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

resource "aws_lambda_function" "photo_matcher" {
  function_name    = local.function_name
  role             = aws_iam_role.photo_matcher.arn
  handler          = "photoMatcher.photoMatcher"
  runtime          = "nodejs22.x" # runtime AWS Lambda gestionado; el tooling local usa Node 24 (ver README)
  memory_size      = 512
  timeout          = local.lambda_timeout_seconds
  filename         = var.lambda_artifact_path
  source_code_hash = filebase64sha256(var.lambda_artifact_path)

  environment {
    variables = {
      FINDLY_TABLE_NAME = var.table_name
    }
  }

  tags = local.tags
}

resource "aws_lambda_event_source_mapping" "photos" {
  event_source_arn        = aws_sqs_queue.photos.arn
  function_name           = aws_lambda_function.photo_matcher.arn
  batch_size              = 5
  function_response_types = ["ReportBatchItemFailures"]
}
