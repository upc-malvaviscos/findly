terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0, < 6.0"
    }
  }
}

locals {
  environments = toset(var.environments)
  oidc_url     = "token.actions.githubusercontent.com"
  # Huella SHA-1 de la CA raiz actual de la cadena de certificados de
  # token.actions.githubusercontent.com (ISRG Root X1, Let's Encrypt),
  # verificada en directo con `openssl s_client` en el momento de escribir
  # este modulo. AWS ya no valida este valor para el proveedor OIDC de
  # GitHub (confia en la cadena TLS directamente), pero el recurso exige
  # el argumento igualmente y con el formato correcto (40 caracteres hex).
  github_thumbprint = "ab9d0263244dd0326eb67015705a667e79cfe998"

  # Politica de despliegue: identica para los 3 entornos hoy, porque
  # ningun modulo existente sufija todavia sus nombres de recurso AWS por
  # entorno (findly-photos-queue, findly-gallery, findly-organizers... son
  # planos, sin -sandbox/-demo/-production). La spec 10 (issue #11) exige
  # ese sufijo ("Verifica que los nombres de los recursos contienen el
  # sufijo -sandbox"); hasta que se adopte, separar los roles por entorno
  # limita QUE ejecucion de workflow puede asumir cada rol (una ejecucion
  # contra 'sandbox' no puede asumir el rol de 'production'), pero no
  # limita EL ALCANCE de recursos de cada rol entre si, ya que ambos
  # conceden acceso al mismo conjunto findly-*. El aislamiento completo de
  # recursos requiere que la issue #11 sufije los nombres y que esta
  # politica se actualice para filtrar por ese sufijo.
  deploy_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "TerraformStateBackend"
        Effect = "Allow"
        Action = ["s3:ListBucket", "s3:GetObject", "s3:PutObject"]
        Resource = [
          "arn:aws:s3:::findly-tfstate-*",
          "arn:aws:s3:::findly-tfstate-*/*",
        ]
      },
      {
        Sid      = "TerraformStateLock"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:DescribeTable"]
        Resource = "arn:aws:dynamodb:*:*:table/findly-tflock"
      },
      {
        Sid    = "ManageAppBuckets"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket", "s3:DeleteBucket", "s3:GetBucketLocation", "s3:GetBucketAcl",
          "s3:PutBucketPolicy", "s3:GetBucketPolicy", "s3:DeleteBucketPolicy",
          "s3:PutBucketPublicAccessBlock", "s3:GetBucketPublicAccessBlock",
          "s3:PutEncryptionConfiguration", "s3:GetEncryptionConfiguration",
          "s3:PutBucketCors", "s3:GetBucketCors",
          "s3:PutBucketTagging", "s3:GetBucketTagging",
          "s3:PutBucketNotification", "s3:GetBucketNotification",
        ]
        Resource = "arn:aws:s3:::findly-*"
      },
      {
        Sid      = "SyncWebBucketContent"
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:PutObject", "s3:DeleteObject", "s3:GetObject"]
        Resource = ["arn:aws:s3:::findly-*", "arn:aws:s3:::findly-*/*"]
      },
      {
        # CloudFront no admite ARNs con id de recurso para las acciones de
        # creacion/listado (Create*, List*); AWS exige Resource "*" para
        # ellas. Se separan de las acciones que si admiten ARN concreto.
        Sid      = "CloudFrontAccountLevel"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateDistribution", "cloudfront:CreateOriginAccessControl", "cloudfront:ListDistributions", "cloudfront:ListOriginAccessControls", "cloudfront:TagResource"]
        Resource = "*"
      },
      {
        Sid    = "CloudFrontResourceLevel"
        Effect = "Allow"
        Action = [
          "cloudfront:GetDistribution", "cloudfront:UpdateDistribution", "cloudfront:DeleteDistribution",
          "cloudfront:GetOriginAccessControl", "cloudfront:UpdateOriginAccessControl", "cloudfront:DeleteOriginAccessControl",
          "cloudfront:CreateInvalidation", "cloudfront:GetInvalidation",
        ]
        Resource = "arn:aws:cloudfront::*:distribution/*"
      },
      {
        Sid    = "ManageLambdas"
        Effect = "Allow"
        Action = [
          "lambda:CreateFunction", "lambda:GetFunction", "lambda:GetFunctionConfiguration",
          "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration", "lambda:DeleteFunction",
          "lambda:TagResource", "lambda:ListTags", "lambda:AddPermission", "lambda:RemovePermission", "lambda:GetPolicy",
          "lambda:CreateEventSourceMapping", "lambda:GetEventSourceMapping", "lambda:UpdateEventSourceMapping",
          "lambda:DeleteEventSourceMapping", "lambda:ListEventSourceMappings",
        ]
        Resource = "arn:aws:lambda:*:*:function:findly-*"
      },
      {
        Sid      = "ManageDeployRoles"
        Effect   = "Allow"
        Action   = ["iam:CreateRole", "iam:GetRole", "iam:DeleteRole", "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy", "iam:TagRole", "iam:ListRolePolicies", "iam:PassRole"]
        Resource = "arn:aws:iam::*:role/findly-*"
      },
      {
        # El propio rol de despliegue debe poder reaplicar el modulo que
        # lo declara a si mismo (bootstrapping del proveedor OIDC).
        Sid      = "ManageOwnOidcProvider"
        Effect   = "Allow"
        Action   = ["iam:CreateOpenIDConnectProvider", "iam:GetOpenIDConnectProvider", "iam:UpdateOpenIDConnectProviderThumbprint", "iam:TagOpenIDConnectProvider", "iam:DeleteOpenIDConnectProvider"]
        Resource = "arn:aws:iam::*:oidc-provider/${local.oidc_url}"
      },
      {
        Sid      = "ManageAppTable"
        Effect   = "Allow"
        Action   = ["dynamodb:CreateTable", "dynamodb:DescribeTable", "dynamodb:UpdateTable", "dynamodb:UpdateTimeToLive", "dynamodb:DeleteTable", "dynamodb:TagResource"]
        Resource = ["arn:aws:dynamodb:*:*:table/findly-*", "arn:aws:dynamodb:*:*:table/findly-*/index/*"]
      },
      {
        Sid      = "ManageQueues"
        Effect   = "Allow"
        Action   = ["sqs:CreateQueue", "sqs:GetQueueAttributes", "sqs:SetQueueAttributes", "sqs:DeleteQueue", "sqs:TagQueue", "sqs:GetQueueUrl"]
        Resource = "arn:aws:sqs:*:*:findly-*"
      },
      {
        Sid      = "ManageSchedules"
        Effect   = "Allow"
        Action   = ["scheduler:CreateSchedule", "scheduler:GetSchedule", "scheduler:UpdateSchedule", "scheduler:DeleteSchedule", "scheduler:TagResource"]
        Resource = "arn:aws:scheduler:*:*:schedule/*/findly-*"
      },
      {
        Sid      = "ManageLogGroups"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:PutRetentionPolicy", "logs:DescribeLogGroups", "logs:TagResource", "logs:ListTagsForResource"]
        Resource = "arn:aws:logs:*:*:log-group:/aws/lambda/findly-*"
      },
      {
        Sid      = "ManageAlarms"
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricAlarm", "cloudwatch:DescribeAlarms", "cloudwatch:DeleteAlarms", "cloudwatch:TagResource"]
        Resource = "arn:aws:cloudwatch:*:*:alarm:findly-*"
      },
      {
        # cognito-idp:CreateUserPool no admite ARN de recurso (se crea sin
        # id previo); el resto de acciones si lo admiten una vez existe.
        Sid      = "CognitoAccountLevel"
        Effect   = "Allow"
        Action   = ["cognito-idp:CreateUserPool"]
        Resource = "*"
      },
      {
        Sid    = "CognitoResourceLevel"
        Effect = "Allow"
        Action = [
          "cognito-idp:DescribeUserPool", "cognito-idp:UpdateUserPool", "cognito-idp:DeleteUserPool", "cognito-idp:TagResource",
          "cognito-idp:CreateUserPoolClient", "cognito-idp:DescribeUserPoolClient", "cognito-idp:UpdateUserPoolClient", "cognito-idp:DeleteUserPoolClient",
        ]
        Resource = "arn:aws:cognito-idp:*:*:userpool/*"
      },
      {
        # API Gateway v2 usa un formato de ARN sin id de cuenta
        # (arn:aws:apigateway:{region}::/apis...); es el modelo de
        # permisos estandar del servicio, no un wildcard evitable.
        Sid      = "ManageApiGateway"
        Effect   = "Allow"
        Action   = "apigateway:*"
        Resource = ["arn:aws:apigateway:*::/apis", "arn:aws:apigateway:*::/apis/*"]
      },
    ]
  })
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://${local.oidc_url}"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [local.github_thumbprint]
  tags = {
    Project    = var.project
    ManagedBy  = "Terraform"
    CostCenter = var.cost_center
  }
}

resource "aws_iam_role" "github_actions" {
  for_each = local.environments

  name = "findly-github-actions-${each.key}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
        Action    = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          # Claim 'sub' que GitHub emite cuando el job usa
          # `environment: <nombre>` (como hace deploy.yml) - mas preciso
          # que restringir solo por rama/ref, ya que ata el rol al
          # entorno de GitHub seleccionado en el propio workflow_dispatch.
          StringEquals = {
            "${local.oidc_url}:aud" = "sts.amazonaws.com"
            "${local.oidc_url}:sub" = "repo:${var.repository}:environment:${each.key}"
          }
        }
      }
    ]
  })
  tags = {
    Project     = var.project
    Environment = each.key
    ManagedBy   = "Terraform"
    CostCenter  = var.cost_center
  }
}

resource "aws_iam_role_policy" "deploy" {
  for_each = local.environments

  name   = "findly-github-actions-${each.key}-deploy-policy"
  role   = aws_iam_role.github_actions[each.key].id
  policy = local.deploy_policy
}
