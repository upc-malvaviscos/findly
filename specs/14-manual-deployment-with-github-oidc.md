# 14 - Despliegue manual seguro mediante autenticación OIDC

## Objetivo
Permitir el despliegue controlado de infraestructura y código hacia AWS sin utilizar credenciales ni claves de acceso de larga duración (`AWS_ACCESS_KEY_ID`), integrando autenticación federada OpenID Connect (OIDC) entre GitHub Actions y AWS IAM.

## Especificación del Workflow de Despliegue Continuo (`.github/workflows/cd.yml`)

```yaml
name: Continuous Deployment

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Entorno de destino'
        required: true
        default: 'sandbox'
        type: choice
        options:
          - sandbox
          - demo
          - production

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - uses: actions/checkout@v4
      
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::ACCOUNT_ID:role/findly-github-actions-${{ inputs.environment }}
          aws-region: eu-west-1
          
      - name: Terraform Apply
        run: |
          cd infra/environments/${{ inputs.environment }}
          terraform init
          terraform apply -auto-approve
          
      - name: Deploy Static Web to S3
        run: |
          npm run build
          aws s3 sync out/ s3://findly-web-${{ inputs.environment }} --delete
          
      - name: Invalidate CloudFront Cache
        run: |
          DIST_ID=$(aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='findly-${{ inputs.environment }}'].Id" --output text)
          aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*"
```

## Requisitos de Seguridad y Control

### Configuración OIDC en AWS IAM
- Asunción de rol mediante `aws-actions/configure-aws-credentials` configurado con OIDC sin credenciales estáticas.
- Trust Policy restringida exclusivamente al repositorio `upc-malvaviscos/findly` y al entorno correspondiente.

### Aprobación de Entornos Protegidos
- Exigencia de aprobación manual previa en los GitHub Environments para despliegues en `demo` o `production`.

## Criterios de Aceptación
- La ejecución del despliegue queda registrada con SHA de Git, usuario aprobador, outputs de Terraform no sensibles y confirmación de invalidación de CloudFront.
- No existen claves estáticas de AWS almacenadas en los secretos del repositorio de GitHub.
