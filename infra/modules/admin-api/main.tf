data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  tags = {
    Project    = var.project, Environment = var.environment, ManagedBy = "Terraform",
    CostCenter = var.cost_center, DataClass = var.data_class
  }
  rekognition_collection_arn = "arn:aws:rekognition:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:collection/${var.project}-${var.environment}-event-*"
  functions = {
    list_events = {
      handler = "adminEvents.listAdminEvents", route = "GET /admin/events"
      statements = [
        { sid = "QueryGsi2", actions = ["dynamodb:Query"], resources = ["${var.table_arn}/index/GSI2"] },
      ]
      extra_env = {}
    }
    create_event = {
      handler = "adminEvents.createAdminEvent", route = "POST /admin/events"
      statements = [
        { sid = "PutEvent", actions = ["dynamodb:PutItem"], resources = [var.table_arn] },
      ]
      extra_env = {}
    }
    create_uploads = {
      handler = "adminEvents.createPhotoUploads", route = "POST /admin/events/{eventId}/photos/uploads"
      statements = [
        { sid = "ReadEventWriteUploads", actions = ["dynamodb:GetItem", "dynamodb:PutItem"], resources = [var.table_arn] },
        { sid = "PutPhotoObject", actions = ["s3:PutObject"], resources = ["${var.uploads_bucket_arn}/events/*/photos/*"] },
      ]
      extra_env = {}
    }
    update_event = {
      handler = "adminEvents.updateAdminEvent", route = "PATCH /admin/events/{eventId}"
      statements = [
        { sid = "UpdateEvent", actions = ["dynamodb:UpdateItem"], resources = [var.table_arn] },
      ]
      extra_env = {}
    }
    list_photos = {
      handler = "adminEvents.listEventPhotos", route = "GET /admin/events/{eventId}/photos"
      statements = [
        { sid = "ReadEventAndPhotos", actions = ["dynamodb:GetItem", "dynamodb:Query"], resources = [var.table_arn] },
      ]
      extra_env = {}
    }
    delete_photo = {
      handler = "adminEvents.deleteEventPhoto", route = "DELETE /admin/events/{eventId}/photos/{photoId}"
      statements = [
        # ADR-022 mirror-item query (PHOTO#eventId#photoId) plus both match
        # items and the Photo row itself all live in the same table.
        # BatchWriteItem clears match/mirror pairs in chunks of 25 instead of
        # one DeleteItem per key (issue #89: that round-trip count blew past
        # this function's timeout under realistic match volume).
        { sid = "FindAndDeleteMatchesAndPhoto", actions = ["dynamodb:Query", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem"], resources = [var.table_arn] },
        { sid = "DeletePhotoObject", actions = ["s3:DeleteObject"], resources = ["${var.uploads_bucket_arn}/events/*/photos/*"] },
      ]
      extra_env = {}
    }
    delete_event = {
      handler = "adminEvents.deleteAdminEvent", route = "DELETE /admin/events/{eventId}"
      statements = [
        { sid = "ReadUpdateDeleteEventAndRecords", actions = ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query"], resources = [var.table_arn] },
        { sid = "ListEventObjects", actions = ["s3:ListBucket"], resources = [var.uploads_bucket_arn], condition = { StringLike = { "s3:prefix" = "events/*" } } },
        { sid = "DeleteEventObjects", actions = ["s3:DeleteObject"], resources = ["${var.uploads_bucket_arn}/events/*"] },
        { sid = "PurgeEventFaceCollection", actions = ["rekognition:DeleteCollection", "rekognition:DeleteFaces", "rekognition:ListFaces"], resources = [local.rekognition_collection_arn] },
      ]
      # Needed by the shared eventCleanup.ts pipeline this handler reuses
      # from retentionPurger (same resource names it already relies on).
      extra_env = { FINDLY_UPLOADS_BUCKET = var.uploads_bucket_name, FINDLY_COLLECTION_NAMESPACE = "${var.project}-${var.environment}" }
    }
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
  permissions_boundary = var.permissions_boundary_arn
  for_each             = local.functions
  name                 = "${var.project}-${var.environment}-admin-${each.key}"
  assume_role_policy   = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
  tags                 = local.tags
}

resource "aws_iam_role_policy" "function" {
  for_each = local.functions
  name     = "${var.project}-${var.environment}-admin-${each.key}"
  role     = aws_iam_role.function[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = concat(
    [{ Sid = "Logs", Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.function[each.key].arn}:*" }],
    [for statement in each.value.statements : merge(
      { Sid = statement.sid, Effect = "Allow", Action = statement.actions, Resource = statement.resources },
      try(statement.condition, null) != null ? { Condition = statement.condition } : {}
    )]
  ) })
}

resource "aws_lambda_function" "function" {
  for_each      = local.functions
  function_name = "${var.project}-${var.environment}-admin-${each.key}"
  role          = aws_iam_role.function[each.key].arn
  handler       = each.value.handler
  runtime       = "nodejs24.x"
  memory_size   = 256
  # delete_photo needs the same headroom as delete_event: cleaning up a
  # photo's matches can mean hundreds of items (issue #89).
  timeout          = contains(["delete_event", "delete_photo"], each.key) ? 60 : 3
  filename         = var.lambda_artifact_path
  source_code_hash = filebase64sha256(var.lambda_artifact_path)
  environment { variables = merge({ FINDLY_TABLE_NAME = var.table_name, FINDLY_PHOTO_BUCKET = var.uploads_bucket_name }, each.value.extra_env) }
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
