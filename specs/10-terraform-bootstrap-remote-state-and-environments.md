# 10 - Estado remoto de Terraform y aislamiento de entornos

## Objetivo
Configurar la gestión del estado remoto de Terraform mediante Amazon S3 y Amazon DynamoDB, garantizando el aislamiento completo entre los entornos de desarrollo (`sandbox`), demostración (`demo`) y producción (`production`), e impidiendo la destrucción accidental de infraestructura.

## Requisitos de Infraestructura de Estado (Bootstrap)

### Bucket de Estado Remoto (S3 Backend)
- Bucket de S3 dedicado `findly-tfstate-${var.aws_account_id}` para almacenar los archivos `.tfstate` con versionado activado (`versioning { enabled = true }`).
- Cifrado del lado del servidor habilitado por defecto (`SSE-S3`).
- Bloqueo de destrucción activado (`prevent_destroy = true`) en el módulo de bootstrap para evitar el borrado del estado remoto.

### Tabla de Bloqueo Concurrente (DynamoDB Lock Table)
- Tabla de DynamoDB `findly-tflock` con clave primaria `LockID` (String) para coordinar ejecuciones concurrentes entre los miembros del equipo.

### Aislamiento de Entornos
- Prefijos de clave S3 separados por entorno:
  - `findly/sandbox/terraform.tfstate`
  - `findly/demo/terraform.tfstate`
  - `findly/production/terraform.tfstate`
- Exigencia de etiquetas obligatorias (`Environment = "sandbox" | "demo" | "production"`, `ManagedBy = "Terraform"`).
- Flag explícito de protección contra destrucción de buckets `allow_bucket_destroy = false` por defecto en entornos productivos y de demo.

## Criterios de Aceptación
- Una ejecución de `terraform plan` en el entorno `sandbox` no interfiere con el estado de `demo` o `production`.
- La configuración de variables secretas solo se documenta mediante plantillas `terraform.tfvars.example`, sin subir secretos al control de versiones.
