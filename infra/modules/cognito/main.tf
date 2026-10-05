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

resource "aws_cognito_user_pool" "organizers" {
  name = var.user_pool_name

  admin_create_user_config {
    allow_admin_create_user_only = true

    invite_message_template {
      email_subject = "Findly: acceso de administración"
      email_message = "Has recibido una invitación para administrar Findly. Usuario: {username}. Contraseña temporal: {####}. Accede a ${var.admin_login_url} y elige tu contraseña definitiva. Si no esperabas esta invitación, contacta con el organizador."
    }
  }

  password_policy {
    temporary_password_validity_days = 7
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
  }

  tags = local.tags
}

resource "aws_cognito_user_pool_client" "web" {
  name                                 = "findly-web"
  user_pool_id                         = aws_cognito_user_pool.organizers.id
  auth_session_validity                = 3
  generate_secret                      = false
  explicit_auth_flows                  = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  allowed_oauth_flows_user_pool_client = false
}
