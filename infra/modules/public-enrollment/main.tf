terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 6.0, < 7.0" }
  }
}
locals {
  prefix = "${var.project}-${var.environment}"
  tags   = { Project = var.project, Environment = var.environment, ManagedBy = "Terraform", CostCenter = var.cost_center, DataClass = var.data_class }
}
locals {
  handlers = {
    events   = { handler = "publicEvents.listPublicEvents", artifact = var.public_events_artifact_path, route = "GET /events" }
    event    = { handler = "publicEvents.getPublicEvent", artifact = var.public_events_artifact_path, route = "GET /events/{eventId}" }
    register = { handler = "publicEnrollment.createPublicRegistration", artifact = var.public_enrollment_artifact_path, route = "POST /events/{eventId}/registrations" }
    status   = { handler = "publicEnrollment.getPublicRegistrationStatus", artifact = var.public_enrollment_artifact_path, route = "GET /registrations/{registrationId}/status" }
    # ADR-018: client-observed enrollment failures; only writes its own logs.
    telemetry = { handler = "publicEnrollment.reportClientEnrollmentError", artifact = var.public_enrollment_artifact_path, route = "POST /telemetry/enrollment-errors" }
  }
  data_actions = {
    events   = { actions = ["dynamodb:Query"], resource = "${var.table_arn}/index/GSI2" }
    event    = { actions = ["dynamodb:GetItem"], resource = var.table_arn }
    register = { actions = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:ConditionCheckItem"], resource = var.table_arn }
    status   = { actions = ["dynamodb:GetItem"], resource = var.table_arn }
  }
}
resource "aws_cloudwatch_log_group" "public" {
  for_each          = local.handlers
  name              = "/aws/lambda/${local.prefix}-public-${each.key}"
  retention_in_days = 14
  tags              = local.tags
}
resource "aws_iam_role" "public" {
  for_each           = local.handlers
  name               = "${local.prefix}-public-${each.key}"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
  tags               = local.tags
}
resource "aws_iam_role_policy" "public" {
  for_each = local.handlers
  role     = aws_iam_role.public[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.public[each.key].arn}:*" }
    ], contains(keys(local.data_actions), each.key) ? [
    { Effect = "Allow", Action = local.data_actions[each.key].actions, Resource = local.data_actions[each.key].resource }
  ] : [], each.key == "register" ? [{ Effect = "Allow", Action = ["s3:PutObject"], Resource = "${var.uploads_bucket_arn}/events/*/selfies/*" }] : []) })
}
resource "aws_lambda_function" "public" {
  for_each         = local.handlers
  function_name    = "${local.prefix}-public-${each.key}"
  role             = aws_iam_role.public[each.key].arn
  handler          = each.value.handler
  runtime          = "nodejs24.x"
  memory_size      = 256
  timeout          = 10
  filename         = each.value.artifact
  source_code_hash = filebase64sha256(each.value.artifact)
  environment {
    variables = { FINDLY_TABLE_NAME = var.table_name, FINDLY_PHOTO_BUCKET = var.uploads_bucket_name, FINDLY_COLLECTION_NAMESPACE = local.prefix }
  }
  depends_on = [aws_cloudwatch_log_group.public]
  tags       = local.tags
}
resource "aws_apigatewayv2_integration" "public" {
  for_each               = local.handlers
  api_id                 = var.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.public[each.key].invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "public" {
  for_each  = local.handlers
  api_id    = var.api_id
  route_key = each.value.route
  target    = "integrations/${aws_apigatewayv2_integration.public[each.key].id}"
}
resource "aws_lambda_permission" "public" {
  for_each      = local.handlers
  statement_id  = "AllowPublicHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.public[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*/${replace(split(" ", each.value.route)[0], " ", "")}/${replace(replace(trimprefix(split(" ", each.value.route)[1], "/"), "{eventId}", "*"), "{registrationId}", "*")}"
}

resource "aws_cloudwatch_log_metric_filter" "public_errors" {
  for_each       = toset(["register", "status"])
  name           = "${local.prefix}-${each.key}-errors"
  log_group_name = aws_cloudwatch_log_group.public[each.key].name
  pattern        = "{ ($.statusCode >= 400) || ($.level = \"ERROR\") }"
  metric_transformation {
    name          = each.key == "register" ? "RegistrationErrors" : "PollingErrors"
    namespace     = "Findly/${var.environment}"
    value         = "1"
    default_value = "0"
  }
}

# ADR-018: one series per enrollment stage; the log line carries only the two
# validated enums, so the dimension space is fixed at three values.
resource "aws_cloudwatch_log_metric_filter" "client_errors" {
  name           = "${local.prefix}-client-enrollment-errors"
  log_group_name = aws_cloudwatch_log_group.public["telemetry"].name
  pattern        = "{ $.event = \"client_enrollment_error\" }"
  metric_transformation {
    name       = "ClientEnrollmentErrors"
    namespace  = "Findly/${var.environment}"
    value      = "1"
    dimensions = { Stage = "$.stage" }
  }
}
