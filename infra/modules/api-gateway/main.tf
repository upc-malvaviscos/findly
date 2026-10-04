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
}

resource "aws_apigatewayv2_api" "http_api" {
  name          = "${var.project}-${var.environment}-api"
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

  # ADR-018: the unauthenticated telemetry route is capped so it cannot be
  # used to drive Lambda/Logs cost. The key comes from the module that owns
  # the route, which orders the stage after the route without a cycle.
  dynamic "route_settings" {
    for_each = toset(var.throttled_route_keys)
    content {
      route_key              = route_settings.value
      throttling_burst_limit = var.throttled_route_burst_limit
      throttling_rate_limit  = var.throttled_route_rate_limit
    }
  }

  tags = local.tags
}
