# 11 - Infraestructura serverless segura y políticas IAM

## Objetivo
Declarar de forma segura toda la arquitectura de la aplicación en Terraform aplicando el principio de mínimo privilegio en los roles IAM, configurando la autenticación federada OIDC para GitHub Actions y garantizando la ausencia de costes fijos mensuales.

## Recursos de Infraestructura Serverless
- **Almacenamiento (S3)**: Buckets privados para frontend (`out/`), selfies y fotos de eventos con cifrado SSE-S3 y bloqueo público.
- **Base de Datos (DynamoDB)**: Tabla única con facturación On-Demand (`PAY_PER_REQUEST`) e índice secundario global (GSI1).
- **Cómputo (AWS Lambda)**: Funciones Node.js 22.x para pre-firmado, indexación facial, matching, consulta de galería y purga.
- **Desacoplamiento (Amazon SQS & DLQ)**: Colas SQS para desacoplar la ingesta de fotos con cola Dead-Letter (DLQ) para reintentos seguros.
- **API Management (Amazon API Gateway HTTP API)**: Rutas HTTP REST con autorizador JWT de Cognito para administración, throttling y CORS estricto.
- **Distribución de Contenidos (AWS CloudFront)**: CDN global servida a través de HTTPS con Origin Access Control (OAC) hacia S3.
- **Autenticación (AWS Cognito)**: User Pool y App Client sin secreto para Single Page Application.
- **Motor Biométrico (AWS Rekognition)**: Colección de vectores faciales por evento.

## Especificaciones de Seguridad e IAM (DevOps Best Practices)

### Configuración del OIDC Provider para GitHub Actions (`oidc.tf`)
```hcl
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "github_ci_cd" {
  name = "findly-github-actions-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringLike = {
            "token.actions.githubusercontent.com:sub" : "repo:upc-malvaviscos/findly:*"
          }
        }
      }
    ]
  })
}
```

### CloudFront Origin Access Control (OAC)
```hcl
resource "aws_cloudfront_origin_access_control" "website" {
  name                              = "findly-oac-${var.environment}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
```

### Permisos de Invocación de API Gateway a Lambda (`aws_lambda_permission`)
- Declarar explícitamente `aws_lambda_permission` por cada función invocada desde API Gateway, restringiendo el `source_arn` al API Gateway del entorno objetivo.

## Criterios de Aceptación
- La ejecución de `terraform fmt -check`, `terraform validate` y `tflint` pasa sin errores.
- El comando `terraform plan` no incluye recursos con coste fijo por hora (RDS, NAT Gateway, instancias EC2).
