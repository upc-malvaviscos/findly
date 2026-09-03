# 14 - Despliegue manual seguro mediante autenticación OIDC

## Objetivo
Permitir el despliegue controlado de infraestructura y código hacia AWS sin utilizar credenciales ni claves de acceso de larga duración (`AWS_ACCESS_KEY_ID`), integrando autenticación federada OpenID Connect (OIDC) entre GitHub Actions y AWS IAM.

## Requisitos de Seguridad y Workflow de Despliegue

### Configuración OIDC en AWS IAM
- Asunción de rol mediante `aws-actions/configure-aws-credentials` configurado con OIDC.
- Trust Policy restringida exclusivamente al repositorio `upc-malvaviscos/findly` y a la rama principal/entornos aprobados.

### Workflow `workflow_dispatch` (`.github/workflows/cd.yml`)
1. Disparo manual con selección obligatoria del entorno de destino (`sandbox`, `demo`, `production`).
2. Generación y visualización del `terraform plan` como paso previo a la aprobación.
3. Exigencia de aprobación en los GitHub Environments protegidos para despliegues en `demo` o `production`.
4. Ejecución automatizada de `terraform apply`.
5. Sincronización del build estático de la web `out/` al bucket S3 correspondiente e invalidación de caché en CloudFront (`aws cloudfront create-invalidation`).

## Criterios de Aceptación
- La ejecución del despliegue queda registrada con SHA de Git, usuario aprobador, outputs de Terraform no sensibles y confirmación de invalidación de CloudFront.
- No existen claves estáticas de AWS almacenadas en los secretos del repositorio de GitHub.
