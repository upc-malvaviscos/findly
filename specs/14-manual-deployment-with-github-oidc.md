# 14 - Despliegue manual seguro mediante autenticación OIDC

## Objetivo
Permitir el despliegue controlado de infraestructura y código hacia AWS sin utilizar credenciales ni claves de acceso de larga duración (`AWS_ACCESS_KEY_ID`), integrando autenticación federada OpenID Connect (OIDC) entre GitHub Actions y AWS IAM.

## Alineación con AWS Well-Architected Framework
- **Seguridad**: Cero credenciales de acceso de larga duración guardadas en GitHub Secrets; uso de asunción de rol temporal mediante OIDC IAM.
- **Excelencia Operativa**: Despliegue automatizado con sincronización S3 (`aws s3 sync dist/`) e invalidación de caché en CloudFront.

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
          aws s3 sync dist/ s3://findly-web-${{ inputs.environment }} --delete
          
      - name: Invalidate CloudFront Cache
        run: |
          DIST_ID=$(aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='findly-${{ inputs.environment }}'].Id" --output text)
          aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*"
```

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Configurar el Workflow YAML
- En `.github/workflows/cd.yml`, copia la especificación YAML.
- Asegúrate de sustituir `ACCOUNT_ID` por el secreto o variable de entorno de AWS Account.

### Paso 2: Probar el Despliegue en Sandbox
- Ejecuta manualmente el workflow mediante `workflow_dispatch` seleccionando `sandbox`.
- Comprueba que la compilación `dist/` se transfiere a S3 y que CloudFront recibe la invalidación `/*`.

## Errores Comunes a Evitar (Pitfalls)
- ❌ **ERROR**: Intentar sincronizar la carpeta antigua `out/` en lugar de `dist/`.
  - *Solución*: Dado que migramos a Vite (ADR-001), el directorio estático es `dist/`.
- ❌ **ERROR**: Olvidar la bandera `--delete` en `aws s3 sync`.
  - *Solución*: De lo contrario, archivos obsoletos o borrados permanecerán en S3.

## Lista de Verificación Pre-PR (Junior Checklist)
- [ ] El workflow CD usa OIDC para asumir el rol IAM sin credenciales estáticas.
- [ ] La carpeta `dist/` se sincroniza correctamente con S3.
- [ ] La invalidación de caché de CloudFront se ejecuta al finalizar la sincronización.
