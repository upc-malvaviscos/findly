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
  }
  oidc_url = "token.actions.githubusercontent.com"
  # AWS ya no valida este thumbprint para el proveedor OIDC de GitHub
  # (verifica la cadena de confianza TLS directamente), pero el recurso
  # exige el argumento igualmente.
  github_thumbprint = "6938fd4d98bab03faadb97b34396831e3780aea"
  subject           = var.allowed_ref == "" ? "repo:${var.repository}:*" : "repo:${var.repository}:${var.allowed_ref}"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://${local.oidc_url}"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [local.github_thumbprint]
  tags            = local.tags
}

resource "aws_iam_role" "github_ci_cd" {
  name = "findly-github-ci-cd"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
        Action    = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "${local.oidc_url}:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "${local.oidc_url}:sub" = local.subject
          }
        }
      }
    ]
  })
  tags = local.tags
}

# No se adjunta ninguna politica de permisos a este rol en esta issue: los
# permisos concretos (s3 sync, invalidacion de CloudFront, terraform
# apply/state) dependen de las acciones exactas que defina la issue de
# despliegue manual (spec 14), que no esta implementada todavia. Adjuntar
# permisos especulativos aqui invitaria a otorgar de mas.
