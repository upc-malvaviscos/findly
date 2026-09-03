# 11 - Infraestructura serverless segura y políticas IAM

## Objetivo
Declarar de forma segura toda la arquitectura de la aplicación en Terraform aplicando el principio de mínimo privilegio en los roles IAM, configurando la autenticación federada OIDC para GitHub Actions y garantizando la ausencia de costes fijos mensuales.

## Alineación con AWS Well-Architected Framework
- **Seguridad**: Autenticación OIDC federada sin claves de acceso estáticas; Origin Access Control (OAC) en CloudFront; roles IAM asignados individualmente por función Lambda.
- **Optimización de Costes (FinOps)**: Ausencia total de recursos con coste por hora (RDS, NAT Gateways, ALB, EC2).

## Declaración de Recursos IaC (Terraform)
- **S3 & CloudFront OAC**: Buckets privados y política restringida a CloudFront mediante `aws_cloudfront_origin_access_control`.
- **Cognito & API Gateway**: User Pool sin secreto cliente y `aws_apigatewayv2_authorizer` de tipo JWT.
- **OIDC Provider (`oidc.tf`)**: `aws_iam_openid_connect_provider` federando `token.actions.githubusercontent.com`.
- **Lambda Permissions**: Permisos `aws_lambda_permission` explícitos por endpoint.

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Configurar el Proveedor OIDC
- En `infra/modules/iam/oidc.tf`, declara el rol `aws_iam_role.github_ci_cd` con la política de confianza restringida al repositorio `upc-malvaviscos/findly`.

### Paso 2: Crear la Configuración de CloudFront OAC
- En `infra/modules/cloudfront/main.tf`, declara `aws_cloudfront_origin_access_control` y adjunta la política S3 correspondiente en el bucket de la web.

### Paso 3: Asignar Roles de Ejecución a Lambdas
- Asegúrate de que cada función Lambda usa su propio rol IAM con permisos restrictivos por ARN de bucket y tabla.

## Errores Comunes a Evitar (Pitfalls)
- ❌ **ERROR**: Usar `Action = "*"` o `Resource = "*"` en las políticas IAM de las Lambdas.
  - *Solución*: Especifica siempre las acciones exactas (`s3:PutObject`, `dynamodb:PutItem`) y los ARNs de los recursos.
- ❌ **ERROR**: Olvidar agregar `aws_lambda_permission` para autorizar a API Gateway.
  - *Solución*: De lo contrario API Gateway devolverá error `500 Internal Server Error` al no poder invocar la Lambda.

## Lista de Verificación Pre-PR (Junior Checklist)
- [ ] `terraform fmt -check`, `terraform validate` y `tflint` pasan sin advertencias.
- [ ] `terraform plan` no aprovisiona recursos con costes fijos (VPCs, RDS, EC2).
- [ ] Los buckets S3 son 100% privados y usan cifrado SSE-S3.
