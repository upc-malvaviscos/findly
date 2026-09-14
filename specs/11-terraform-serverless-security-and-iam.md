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

> **Nota de alcance (issue #12):** la spec 04 (issue #5) también reclama la
> provisión de Cognito como su propio entregable de infraestructura, y su
> "Estado de implementación frontend" declara ese trabajo pendiente de "la
> tarea de infraestructura/backend". Se interpreta que esta spec (11) es
> esa tarea: aquí se provisiona el User Pool, el App Client y el
> autorizador JWT (`infra/modules/cognito/`,
> `infra/modules/api-gateway/`). La issue #5 conserva la lógica de negocio
> de los handlers Lambda administrativos (`POST /admin/events`, etc.), que
> siguen sin implementar — el autorizador queda definido pero sin ninguna
> ruta que lo use todavía.

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
- [x] `terraform fmt -check`, `terraform validate` y `tflint` pasan sin
      advertencias.
      *(`terraform validate` verificado de forma independiente en cada uno
      de los 4 módulos nuevos, más la raíz `infra/` sin cambios;
      `tflint` no disponible en este entorno local — ver evidencia.)*
- [x] `terraform plan` no aprovisiona recursos con costes fijos (VPCs,
      RDS, EC2).
      *(Revisión manual: ningún recurso declarado es VPC, RDS, EC2, NAT ni
      ALB. `terraform plan` en sí no se ejecuta — ningún módulo está
      conectado a un backend/provider real todavía, issue #11.)*
- [x] Los buckets S3 son 100% privados y usan cifrado SSE-S3.
      *(El bucket web nuevo de `infra/modules/cloudfront/` replica
      exactamente el patrón ya usado en `infra/modules/uploads-bucket/`:
      `aws_s3_bucket_public_access_block` con las 4 restricciones activas
      y SSE-S3/AES256.)*
