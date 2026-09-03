# 10 - Estado remoto de Terraform y aislamiento de entornos

## Objetivo
Configurar la gestión del estado remoto de Terraform mediante Amazon S3 y Amazon DynamoDB, definendo la estructura del repositorio de infraestructura y garantizando el aislamiento completo entre los entornos de desarrollo (`sandbox`), demostración (`demo`) y producción (`production`).

## Alineación con AWS Well-Architected Framework
- **Excelencia Operativa**: Aislamiento estricto de entornos por carpetas y prefijos S3; etiquetado estándar vía `default_tags`.
- **Fiabilidad**: Bloqueo concurrente con DynamoDB `findly-tflock` para prevenir sobrescrituras colisionadas en el equipo.
- **Seguridad**: Versionado y cifrado en reposo SSE-S3 del estado remoto con `prevent_destroy = true`.

## Estructura de Carpetas e Infraestructura Terraform

```
infra/
├── modules/
│   ├── api_gateway/
│   ├── cognito/
│   ├── dynamodb/
│   ├── lambda/
│   ├── rekognition/
│   ├── s3/
│   └── sqs/
└── environments/
    ├── sandbox/
    │   ├── main.tf
    │   ├── variables.tf
    │   ├── outputs.tf
    │   └── terraform.tfvars
    ├── demo/
    └── production/
```

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Configurar el Proveedor AWS
- En `infra/environments/sandbox/main.tf`, define el bloque `provider "aws"` con `default_tags` obligatorio.

### Paso 2: Inicializar el Backend Remoto
- Configura `backend "s3"` con `bucket = "findly-tfstate-ACCOUNT_ID"`, `key = "findly/sandbox/terraform.tfstate"` y `dynamodb_table = "findly-tflock"`.
- Ejecuta `terraform init`.

### Paso 3: Validar la Separación de Entornos
- Ejecuta `terraform plan`. Verifica que los nombres de los recursos contienen el sufijo `-sandbox`.

## Errores Comunes a Evitar (Pitfalls)
- ❌ **ERROR**: Modificar manualmente el archivo `terraform.tfstate` en S3.
  - *Solución*: Nunca edites el archivo de estado directamente. Usa comandos `terraform state`.
- ❌ **ERROR**: Olvidar incluir `allow_bucket_destroy = false` en entornos demo o producción.
  - *Solución*: Esta bandera previene la pérdida accidental de datos en buckets productivos.

## Lista de Verificación Pre-PR (Junior Checklist)
- [ ] `terraform fmt -check`, `terraform validate` y `tflint` pasan en verde.
- [ ] El plan de `sandbox` no interfiere con `demo` o `production`.
- [ ] `terraform.tfvars` no contiene contraseñas o secretos en texto claro subidos al repositorio.
