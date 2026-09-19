# 10 - Estado remoto de Terraform y aislamiento de entornos

GitHub issue: #11. Evidencia: `docs/evidence/issue-11-terraform-remote-state.md`.

## Objetivo

Configurar la gestión del estado remoto de Terraform mediante Amazon S3 y Amazon DynamoDB, definendo la estructura del repositorio de infraestructura y garantizando el aislamiento completo entre los entornos de desarrollo (`sandbox`), demostración (`demo`) y producción (`production`).

## Alineación con AWS Well-Architected Framework

- **Excelencia Operativa**: Aislamiento estricto de entornos por carpetas y prefijos S3; etiquetado estándar vía `default_tags`.
- **Fiabilidad**: Bloqueo concurrente con el lockfile nativo de S3 (`use_lockfile=true`) para prevenir sobrescrituras colisionadas en el equipo. Se sustituye la tabla DynamoDB `findly-tflock` de la spec original ([ADR-009](../docs/adr/ADR-009-terraform-remote-state-and-environment-isolation.md)).
- **Seguridad**: Versionado y cifrado en reposo SSE-S3 del estado remoto con `prevent_destroy = true`.

## Estructura de Carpetas e Infraestructura Terraform

```
infra/
├── modules/
│   ├── api_gateway/
│   ├── cognito/
│   ├── dynamodb/
│   ├── findly-stack/      # composición compartida por los entornos
│   └── ...                # admin-api, gallery-reader, uploads-bucket, etc.
├── bootstrap/             # bucket de estado (estado local, se aplica una vez)
├── ephemeral/             # entorno por PR (ADR-008)
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

- Configura `backend "s3" {}` parcial y pasa `bucket = "findly-tfstate-ACCOUNT_ID"`, `key = "findly/sandbox/terraform.tfstate"` y `use_lockfile=true` con `-backend-config` (véase `docs/runbooks/terraform-remote-state.md`).
- Ejecuta `terraform init`.

### Paso 3: Validar la Separación de Entornos

- Ejecuta `terraform plan`. Verifica que los nombres de los recursos contienen el sufijo `-sandbox`.

## Errores Comunes a Evitar (Pitfalls)

- ❌ **ERROR**: Modificar manualmente el archivo `terraform.tfstate` en S3.
  - _Solución_: Nunca edites el archivo de estado directamente. Usa comandos `terraform state`.
- ❌ **ERROR**: Olvidar incluir `allow_bucket_destroy = false` en entornos demo o producción.
  - _Solución_: Esta bandera previene la pérdida accidental de datos en buckets productivos.

## Lista de Verificación Pre-PR (Junior Checklist)

- [x] `terraform fmt -check`, `terraform validate` y `tflint` pasan en verde (`npm run terraform:format`, `terraform:validate`, `lint:terraform`; evidencia en `docs/evidence/issue-11-terraform-remote-state.md`).
- [x] El plan de `sandbox` no interfiere con `demo` o `production`.
- [x] `terraform.tfvars` no contiene contraseñas o secretos en texto claro subidos al repositorio.

> Pendiente (#61, subissue de #11): bootstrap completo en `eu-west-1` con permisos suficientes (el Learner Lab lo deniega) y `plan` de `moved` contra un estado sandbox existente con `0 to destroy`.
