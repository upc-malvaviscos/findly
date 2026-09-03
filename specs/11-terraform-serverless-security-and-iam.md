# 11 - Infraestructura serverless segura

## Objetivo
Provisionar la arquitectura con privilegio mínimo y sin coste de red fijo.

## Requisitos
- Declarar S3, DynamoDB on-demand, Lambda, API Gateway, CloudFront, Cognito, Rekognition, Scheduler, logs y tags.
- Limitar IAM por función y prefijo S3; evitar `AdministratorAccess` salvo una excepción ADR temporal para bootstrap.
- Validar cifrado, bloqueo público, retención de logs y origen CORS.

## Aceptación
`terraform fmt -check`, `validate` y un plan revisado no introducen RDS, NAT, VPC ni recursos no etiquetados.
