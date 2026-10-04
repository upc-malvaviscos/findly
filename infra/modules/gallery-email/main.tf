terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0, < 7.0"
    }
  }
}
locals {
  prefix = "${var.project}-${var.environment}-gallery-email"
  tags   = { Project = var.project, Environment = var.environment, ManagedBy = "Terraform", CostCenter = var.cost_center, DataClass = var.data_class }
  functions = {
    request  = { handler = "galleryEmail.requestGalleryEmail", artifact = var.artifact_path, timeout = 10 }
    status   = { handler = "galleryEmail.getGalleryEmailStatus", artifact = var.artifact_path, timeout = 5 }
    worker   = { handler = "galleryEmail.processGalleryEmail", artifact = var.artifact_path, timeout = 60 }
    feedback = { handler = "galleryEmailFeedback.galleryEmailFeedback", artifact = var.feedback_artifact_path, timeout = 10 }
  }
  routes = { request = "POST /admin/events/{eventId}/gallery-emails", status = "GET /admin/events/{eventId}/gallery-emails/{operationId}" }
}
resource "aws_sqs_queue" "dead_letters" {
  name                      = "${local.prefix}-dlq.fifo"
  fifo_queue                = true
  message_retention_seconds = 86400
  sqs_managed_sse_enabled   = true
  tags                      = local.tags
}
resource "aws_sqs_queue" "work" {
  name                       = "${local.prefix}.fifo"
  fifo_queue                 = true
  visibility_timeout_seconds = 360
  message_retention_seconds  = 86400
  sqs_managed_sse_enabled    = true
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.dead_letters.arn, maxReceiveCount = 5 })
  tags                       = local.tags
}
resource "aws_sqs_queue" "feedback_dlq" {
  name                      = "${local.prefix}-feedback-dlq"
  message_retention_seconds = 3600
  sqs_managed_sse_enabled   = true
  tags                      = local.tags
}
resource "aws_sqs_queue" "feedback" {
  name                       = "${local.prefix}-feedback"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 3600
  sqs_managed_sse_enabled    = true
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.feedback_dlq.arn, maxReceiveCount = 5 })
  tags                       = local.tags
}
resource "aws_sns_topic" "feedback" {
  name = "${local.prefix}-feedback"
  tags = local.tags
}
resource "aws_sns_topic_policy" "feedback" {
  arn    = aws_sns_topic.feedback.arn
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ses.amazonaws.com" }, Action = "sns:Publish", Resource = aws_sns_topic.feedback.arn, Condition = { StringEquals = { "AWS:SourceAccount" = split(":", var.identity_arn)[4] }, ArnEquals = { "AWS:SourceArn" = aws_sesv2_configuration_set.email.arn } } }] })
}
resource "aws_sqs_queue_policy" "feedback" {
  queue_url = aws_sqs_queue.feedback.id
  policy    = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "sns.amazonaws.com" }, Action = "sqs:SendMessage", Resource = aws_sqs_queue.feedback.arn, Condition = { ArnEquals = { "aws:SourceArn" = aws_sns_topic.feedback.arn } } }] })
}
resource "aws_sns_topic_subscription" "feedback" {
  topic_arn            = aws_sns_topic.feedback.arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.feedback.arn
  raw_message_delivery = true
}
resource "aws_sesv2_configuration_set" "email" {
  configuration_set_name = local.prefix
  suppression_options { suppressed_reasons = ["BOUNCE", "COMPLAINT"] }
  tags = local.tags
}
resource "aws_sesv2_configuration_set_event_destination" "feedback" {
  configuration_set_name = aws_sesv2_configuration_set.email.configuration_set_name
  event_destination_name = "feedback"
  event_destination {
    enabled              = true
    matching_event_types = ["BOUNCE", "COMPLAINT"]
    sns_destination { topic_arn = aws_sns_topic.feedback.arn }
  }
  depends_on = [aws_sns_topic_policy.feedback]
}
resource "aws_cloudwatch_log_group" "function" {
  for_each          = local.functions
  name              = "/aws/lambda/${local.prefix}-${each.key}"
  retention_in_days = 14
  tags              = local.tags
}
resource "aws_iam_role" "function" {
  permissions_boundary = var.permissions_boundary_arn
  for_each             = local.functions
  name                 = "${local.prefix}-${each.key}"
  assume_role_policy   = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
  tags                 = local.tags
}
resource "aws_iam_role_policy" "function" {
  for_each = local.functions
  name     = "application"
  role     = aws_iam_role.function[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.function[each.key].arn}:*" },
    { Effect = "Allow", Action = each.key == "status" ? ["dynamodb:GetItem"] : each.key == "request" ? ["dynamodb:GetItem", "dynamodb:PutItem"] : each.key == "feedback" ? ["dynamodb:UpdateItem"] : ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:ConditionCheckItem"], Resource = var.table_arn }
    ], [for stmt in [{ Effect = "Allow", Action = "sqs:SendMessage", Resource = aws_sqs_queue.work.arn }] : stmt if contains(["request", "worker"], each.key)], [for stmt in [
      { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = aws_sqs_queue.work.arn },
      { Effect = "Allow", Action = "s3:GetObject", Resource = "${var.uploads_bucket_arn}/events/*/photos/*" },
      { Effect = "Allow", Action = "ses:SendEmail", Resource = [var.identity_arn, aws_sesv2_configuration_set.email.arn], Condition = { StringEquals = { "ses:FromAddress" = var.from_address } } },
      # The SES suppression API does not support resource-level permissions.
      { Effect = "Allow", Action = "ses:GetSuppressedDestination", Resource = "*" }
  ] : stmt if each.key == "worker"], [for stmt in [{ Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = aws_sqs_queue.feedback.arn }] : stmt if each.key == "feedback"]) })
}
resource "aws_lambda_function" "function" {
  for_each         = local.functions
  function_name    = "${local.prefix}-${each.key}"
  role             = aws_iam_role.function[each.key].arn
  handler          = each.value.handler
  runtime          = "nodejs24.x"
  memory_size      = 256
  timeout          = each.value.timeout
  filename         = each.value.artifact
  source_code_hash = filebase64sha256(each.value.artifact)
  environment {
    variables = {
      FINDLY_TABLE_NAME              = var.table_name
      FINDLY_PHOTO_BUCKET            = var.uploads_bucket_name
      FINDLY_EMAIL_QUEUE_URL         = aws_sqs_queue.work.id
      FINDLY_EMAIL_CONFIGURATION_SET = aws_sesv2_configuration_set.email.configuration_set_name
      FINDLY_EMAIL_FROM              = var.from_address
      FINDLY_GALLERY_ORIGIN          = var.gallery_origin
    }
  }
  lifecycle {
    precondition {
      condition     = can(regex("^[^@ ]+@[^@ ]+[.][^@ ]+$", var.from_address)) && can(regex("^arn:aws:ses:eu-west-1:[0-9]{12}:identity/", var.identity_arn))
      error_message = "Set a valid sender and a verified eu-west-1 SES identity before enabling gallery email."
    }
  }
  depends_on = [aws_cloudwatch_log_group.function]
  tags       = local.tags
}
resource "aws_lambda_event_source_mapping" "work" {
  event_source_arn = aws_sqs_queue.work.arn
  function_name    = aws_lambda_function.function["worker"].arn
  batch_size       = 1
  scaling_config { maximum_concurrency = 2 }
}
resource "aws_lambda_event_source_mapping" "feedback" {
  event_source_arn = aws_sqs_queue.feedback.arn
  function_name    = aws_lambda_function.function["feedback"].arn
  batch_size       = 1
  scaling_config { maximum_concurrency = 2 }
}
resource "aws_apigatewayv2_integration" "function" {
  for_each               = local.routes
  api_id                 = var.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.function[each.key].invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "function" {
  for_each           = local.routes
  api_id             = var.api_id
  route_key          = each.value
  target             = "integrations/${aws_apigatewayv2_integration.function[each.key].id}"
  authorization_type = "JWT"
  authorizer_id      = var.authorizer_id
}
resource "aws_lambda_permission" "api_gateway" {
  for_each      = local.routes
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.function[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*/*"
}
resource "aws_cloudwatch_metric_alarm" "dead_letters" {
  for_each            = { work = aws_sqs_queue.dead_letters.name, feedback = aws_sqs_queue.feedback_dlq.name }
  alarm_name          = "${local.prefix}-${each.key}-dlq"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = each.value }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_actions
  tags                = local.tags
}
