locals {
  tags = {
    Project    = var.project, Environment = var.environment, ManagedBy = "Terraform",
    CostCenter = var.cost_center, DataClass = var.data_class
  }
  functions = {
    list_events    = { handler = "adminEvents.listAdminEvents", route = "GET /admin/events", actions = ["dynamodb:Query"], resources = ["${var.table_arn}/index/GSI2"] }
    create_event   = { handler = "adminEvents.createAdminEvent", route = "POST /admin/events", actions = ["dynamodb:PutItem"], resources = [var.table_arn] }
    create_uploads = { handler = "adminEvents.createPhotoUploads", route = "POST /admin/events/{eventId}/photos/uploads", actions = ["dynamodb:GetItem", "dynamodb:PutItem", "s3:PutObject"], resources = [var.table_arn, "${var.uploads_bucket_arn}/events/*/photos/*"] }
  }
}

resource "aws_apigatewayv2_authorizer" "organizers" {
  api_id           = var.api_id
  name             = "${var.project}-${var.environment}-organizers"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  jwt_configuration {
    audience = [var.user_pool_client_id]
    issuer   = var.user_pool_issuer_url
  }
}

resource "aws_cloudwatch_log_group" "function" {
  for_each          = local.functions
  name              = "/aws/lambda/${var.project}-${var.environment}-admin-${each.key}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_iam_role" "function" {
  for_each           = local.functions
  name               = "${var.project}-${var.environment}-admin-${each.key}"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
  tags               = local.tags
}

resource "aws_iam_role_policy" "function" {
  for_each = local.functions
  name     = "${var.project}-${var.environment}-admin-${each.key}"
  role     = aws_iam_role.function[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "Logs", Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.function[each.key].arn}:*" },
    { Sid = "ApplicationData", Effect = "Allow", Action = each.value.actions, Resource = each.value.resources }
  ] })
}

resource "aws_lambda_function" "function" {
  for_each         = local.functions
  function_name    = "${var.project}-${var.environment}-admin-${each.key}"
  role             = aws_iam_role.function[each.key].arn
  handler          = each.value.handler
  runtime          = "nodejs22.x"
  memory_size      = 256
  timeout          = 3
  filename         = var.lambda_artifact_path
  source_code_hash = filebase64sha256(var.lambda_artifact_path)
  environment { variables = { FINDLY_TABLE_NAME = var.table_name, FINDLY_PHOTO_BUCKET = var.uploads_bucket_name } }
  tags = local.tags
}

resource "aws_apigatewayv2_integration" "function" {
  for_each               = local.functions
  api_id                 = var.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.function[each.key].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "function" {
  for_each           = local.functions
  api_id             = var.api_id
  route_key          = each.value.route
  target             = "integrations/${aws_apigatewayv2_integration.function[each.key].id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.organizers.id
}

resource "aws_lambda_permission" "api_gateway" {
  for_each      = local.functions
  statement_id  = "AllowApiGateway${replace(title(each.key), "_", "")}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.function[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*/*"
}
