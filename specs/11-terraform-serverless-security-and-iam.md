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

> **Alcance vigente (#12):** PR #48 verifica plan sin servicios excluidos y
> privacidad/SSE-S3 del bucket de cargas del entorno efímero. PR #59 entrega
> Cognito, autorizador JWT y rutas administrativas en `admin-api`. El módulo
> CloudFront/OAC existe, pero no se instancia en los roots auditados; su
> publicación y dominio/certificado pertenecen a #15. No extrapolar la
> comprobación del bucket de cargas a CloudFront ni a todos los entornos.

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Configurar el Proveedor OIDC

- En `infra/modules/github-oidc/main.tf`, declara el rol `aws_iam_role.github_ci_cd` con la política de confianza restringida al repositorio `upc-malvaviscos/findly`.

### Paso 2: Crear la Configuración de CloudFront OAC

- En `infra/modules/cloudfront/main.tf`, declara `aws_cloudfront_origin_access_control` y adjunta la política S3 correspondiente en el bucket de la web.

### Paso 3: Asignar Roles de Ejecución a Lambdas

- Asegúrate de que cada función Lambda usa su propio rol IAM con permisos restrictivos por ARN de bucket y tabla.

## Errores Comunes a Evitar (Pitfalls)

- ❌ **ERROR**: Usar `Action = "*"` o `Resource = "*"` en las políticas IAM de las Lambdas.
  - _Solución_: Especifica siempre las acciones exactas (`s3:PutObject`, `dynamodb:PutItem`) y los ARNs de los recursos.
- ❌ **ERROR**: Olvidar agregar `aws_lambda_permission` para autorizar a API Gateway.
  - _Solución_: De lo contrario API Gateway devolverá error `500 Internal Server Error` al no poder invocar la Lambda.

## Lista de Verificación Pre-PR (Junior Checklist)

- [x] `terraform fmt -check`, `terraform validate` y `tflint` pasan en CI.
- [x] El plan efímero de PR #48 no incluye VPC, RDS, EC2, NAT ni ALB.
- [x] El bucket de cargas del entorno probado es privado y usa SSE-S3.
- [ ] CloudFront/OAC, dominio y TLSv1.2_2021 se publican/verifican en #15.

La evidencia histórica del módulo aislado se conserva; la aceptación actual
está delimitada en [la auditoría #70](../docs/evidence/issue-checklist-audit.md).
