# Runbook: estado remoto de Terraform y entornos

No se guardan estados, credenciales ni outputs en Git. Usa credenciales AWS
temporales. Nunca edites `terraform.tfstate` en S3; usa `terraform state`.

## 1. Bootstrap del bucket de estado (una vez, persona administradora)

```sh
cd infra/bootstrap
terraform init
terraform plan
terraform apply   # sólo con autorización explícita
terraform output state_bucket_name
```

El estado de este root es local y no se versiona. El bucket tiene
`prevent_destroy`; no lo destruyas.

## 2. Inicializar un entorno

```sh
cd infra/environments/<sandbox|demo|production>
terraform init \
  -backend-config="bucket=<state_bucket_name>" \
  -backend-config="key=findly/<entorno>/terraform.tfstate" \
  -backend-config="region=eu-west-1" \
  -backend-config="encrypt=true" \
  -backend-config="use_lockfile=true"
terraform plan
```

Sustituye en `terraform.tfvars` el nombre del bucket de subidas por uno único
de tu cuenta (`findly-<entorno>-<ACCOUNT_ID>-eu-west-1`) y comprueba en el plan
que todos los recursos terminan en el sufijo del entorno y llevan la etiqueta
`Environment=<entorno>`.

## 3. Migrar el estado sandbox existente

Los bloques `moved` de `environments/sandbox` reubican los módulos bajo
`module.findly`. Ejecuta `terraform plan` y comprueba `0 to destroy` y que sólo
hay movimientos antes de cualquier `apply`.

## Reglas

- `allow_bucket_destroy` es `false` en `demo` y `production`.
- El rol de CI efímero no tiene acceso a `findly/*`; sólo a `ephemeral/pr-*`.
