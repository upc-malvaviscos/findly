# 11 - Infraestructura serverless segura y políticas IAM

## Objetivo
Declarar de forma segura toda la arquitectura de la aplicación en Terraform aplicando el principio de mínimo privilegio en los roles IAM y garantizando la ausencia de costes fijos mensuales (sin VPCs ni instancias RDS).

## Recursos de Infraestructura Serverless
- **Almacenamiento (S3)**: Buckets privados para frontend (`out/`), selfies y fotos de eventos con cifrado SSE-S3 y bloqueo público.
- **Base de Datos (DynamoDB)**: Tabla única con facturación On-Demand (`PAY_PER_REQUEST`) e índice secundario global (GSI1).
- **Cómputo (AWS Lambda)**: Funciones Node.js 22.x para pre-firmado, indexación facial, matching, consulta de galería y purga.
- **Desacoplamiento (Amazon SQS & DLQ)**: Colas SQS para desacoplar la ingesta de fotos con cola Dead-Letter (DLQ) para reintentos seguros.
- **API Management (Amazon API Gateway HTTP API)**: Rutas HTTP REST con autorizador JWT de Cognito para administración, throttling y CORS estricto.
- **Distribución de Contenidos (AWS CloudFront)**: CDN global servida a través de HTTPS con Origin Access Control (OAC) hacia S3.
- **Autenticación (AWS Cognito)**: User Pool y App Client sin secreto para Single Page Application.
- **Motor Biométrico (AWS Rekognition)**: Colección de vectores faciales por evento.

## Especificaciones de Seguridad e IAM (AWS Best Practices)

### CloudFront Origin Access Control (OAC)
```hcl
resource "aws_cloudfront_origin_access_control" "website" {
  name                              = "findly-oac-${var.environment}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
```

### Política de Bucket S3 Restringida a CloudFront
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipalReadOnly",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::findly-web-${var.environment}/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::${var.aws_account_id}:distribution/${aws_cloudfront_distribution.website.id}"
        }
      }
    }
  ]
}
```

### Principios de Seguridad IAM
- Cada función Lambda dispone de su propio rol de ejecución IAM asignado explícitamente (`Least Privilege`).
- Restricción de permisos S3 por prefijo exacto (`arn:aws:s3:::bucket/events/${eventId}/*`).
- Prohibición de otorgar permisos `AdministratorAccess` ni comodines desprotegidos (`*`) salvo excepciones registradas por ADR.

## Criterios de Aceptación
- La ejecución de `terraform fmt -check`, `terraform validate` y `tflint` pasa sin errores.
- El comando `terraform plan` no incluye recursos con coste fijo por hora (RDS, NAT Gateway, instancias EC2).
