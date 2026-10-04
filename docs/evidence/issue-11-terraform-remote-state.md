# Evidencia: estado remoto de Terraform y entornos (issue #11)

Spec: `specs/10-terraform-bootstrap-remote-state-and-environments.md`.
Decisión: [ADR-009](../adr/ADR-009-terraform-remote-state-and-environment-isolation.md).

## Validaciones locales (Terraform 1.15.0, Node 24)

```sh
npm run terraform:format   # fmt -check -recursive
npm run terraform:validate # bootstrap, sandbox, demo, production, ephemeral
npm run lint:terraform     # tflint en los mismos cinco roots
npx vitest run --project infra   # 22 pruebas estáticas de aislamiento
```

## Criterios

| Criterio                                                   | Estado                                                                                                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fmt`, `validate` y `tflint` en verde                      | Demostrado (comandos anteriores).                                                                                                                          |
| `terraform.tfvars` sin secretos                            | Demostrado por test estático.                                                                                                                              |
| El plan de `sandbox` no interfiere con `demo`/`production` | `plan` real de sandbox con clave de estado propia (`findly/sandbox/terraform.tfstate`) y `Environment=sandbox`. No se ejecutó plan de `demo`/`production`. |
| Bootstrap del bucket de estado en `eu-west-1`              | **Demostrado** (#61, cuenta AWS dedicada): versionado, SSE-S3, bloqueo público, TLS-only y ciclo de vida leídos de AWS.                                    |
| Migración del estado sandbox sin destroy (`moved`)         | **Demostrado** (#61): los 38 recursos del estado previo se mueven bajo `module.findly`; `0 to destroy`.                                                    |

## Verificación en cuenta AWS dedicada (`eu-west-1`, issue #61)

Fecha: 2026-10-02. Terraform 1.15.0, proveedor AWS 6.66.0 (lockfile del
repositorio). Cuenta AWS propia sin SCP educativas, usuario IAM temporal de
pruebas con `AdministratorAccess`. El ID de cuenta se sustituye por `<cuenta>`.

### 1. Bootstrap del bucket de estado

```sh
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap plan    # Plan: 6 to add, 0 to change, 0 to destroy.
terraform -chdir=infra/bootstrap apply   # Apply complete! Resources: 6 added, 0 changed, 0 destroyed.
                                         # state_bucket_name = "findly-tfstate-<cuenta>"
terraform -chdir=infra/bootstrap plan    # No changes.
```

Configuración leída de AWS tras el `apply`:

| Comprobación (`aws s3api …`)         | Resultado                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `get-bucket-location`                | `eu-west-1`                                                                                                     |
| `get-bucket-versioning`              | `Enabled`                                                                                                       |
| `get-bucket-encryption`              | `SSEAlgorithm: AES256` (SSE-S3)                                                                                 |
| `get-public-access-block`            | `BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`, `RestrictPublicBuckets` a `true`                    |
| `get-bucket-policy`                  | `DenyInsecureTransport`: `Deny s3:*` sobre bucket y objetos si `aws:SecureTransport=false`                      |
| `get-bucket-lifecycle-configuration` | `expire-noncurrent-state-versions`: `NoncurrentDays: 90`                                                        |
| `get-bucket-tagging`                 | `Project=findly`, `Environment=shared`, `ManagedBy=Terraform`, `CostCenter=findly`, `DataClass=terraform-state` |

Prueba de TLS-only con una petición **firmada** por el mismo administrador:

```text
$ aws s3api list-objects-v2 --bucket findly-tfstate-<cuenta> --endpoint-url http://s3.eu-west-1.amazonaws.com
An error occurred (AccessDenied) ... not authorized to perform: s3:ListBucket on resource:
"arn:aws:s3:::findly-tfstate-<cuenta>" with an explicit deny in a resource-based policy
$ aws s3api list-objects-v2 --bucket findly-tfstate-<cuenta>          # HTTPS
{ "Prefix": "" }   (exit 0)
```

### 2. Estado sandbox previo (raíz antigua sin módulo)

Para tener un estado con las direcciones anteriores a ADR-009 se desplegó la
raíz `infra/` del commit `86ddf94^` (padre del commit de PR #62) en un
`git worktree` temporal, con sus propios artefactos Lambda, contra el backend
real y la clave del entorno:

```sh
terraform -chdir=infra init \
  -backend-config="bucket=findly-tfstate-<cuenta>" \
  -backend-config="key=findly/sandbox/terraform.tfstate" \
  -backend-config="region=eu-west-1" \
  -backend-config="encrypt=true" \
  -backend-config="use_lockfile=true"
# TF_VAR_environment=sandbox, TF_VAR_data_class=synthetic,
# TF_VAR_frontend_domain_url=http://127.0.0.1:5173,
# TF_VAR_uploads_bucket_name=findly-sandbox-<cuenta>-eu-west-1
terraform -chdir=infra plan    # Plan: 38 to add, 0 to change, 0 to destroy.
terraform -chdir=infra apply   # Apply complete! Resources: 38 added, 0 changed, 0 destroyed.
```

Estado resultante: `module.admin_api` (22), `module.gallery_reader` (7),
`module.uploads_bucket` (4), `module.api_gateway` (2), `module.cognito` (2 +
1 data source) y `module.dynamodb` (1), todos en la raíz, con proveedor AWS v5.

### 3. `init` y `plan` de `environments/sandbox` actual contra ese estado

```sh
npm run build:lambdas && npm run package:lambdas
terraform -chdir=infra/environments/sandbox init <mismos -backend-config>
terraform -chdir=infra/environments/sandbox plan -out=sandbox.tfplan \
  -var="uploads_bucket_name=findly-sandbox-<cuenta>-eu-west-1"
# Plan: 63 to add, 6 to change, 0 to destroy.
terraform -chdir=infra/environments/sandbox show -json sandbox.tfplan \
  | node scripts/check-deployment-plan.mjs
# Deployment plan preserves existing resources and the serverless boundary.
```

Resumen del JSON del plan (`jq` sobre `resource_changes` gestionados):

| Métrica                                    | Valor |
| ------------------------------------------ | ----- |
| Recursos con `previous_address` (movidos)  | 38    |
| … movidos sin cambios (`no-op`)            | 32    |
| … movidos con `update` in-place            | 6     |
| `delete` o `replace`                       | **0** |
| `create` (módulos nuevos desde `86ddf94^`) | 63    |

Los 38 recursos del estado previo se reubican bajo `module.findly.module.*`
(p. ej. `module.dynamodb.aws_dynamodb_table.findly has moved to
module.findly.module.dynamodb.aws_dynamodb_table.findly`). Ninguno se destruye
ni se recrea. Los 6 `update` in-place se deben a la evolución del código
desde ese commit, no a los `moved`:

- 4 Lambdas (`admin_api` ×3, `gallery_reader`): `runtime` `nodejs22.x` →
  `nodejs24.x` y nuevo `source_code_hash`.
- Bucket de subidas: `force_destroy` → `true` (`allow_bucket_destroy=true`
  en sandbox).
- CORS del bucket de subidas: `allowed_headers` añade `If-None-Match`.

Las 63 altas pertenecen a los módulos incorporados después:
`public_enrollment` (30), `photo_matching` (10), `delete_registration` (7),
`retention_purger` (7), `selfie_indexer` (6) y `monitoring` (3). El plan
**no se aplicó**.

### 4. Limpieza

```sh
terraform -chdir=infra destroy   # (raíz antigua) Destroy complete! Resources: 38 destroyed.
```

Comprobaciones posteriores: `terraform state list` vacío; sin Lambdas
`findly*`, tablas DynamoDB, HTTP APIs ni user pools de Cognito. La API de
etiquetas aún listaba el user pool unos segundos después, pero
`describe-user-pool` devolvía `ResourceNotFoundException` (retraso del índice
de etiquetas). El worktree temporal se eliminó y el `.terraform.lock.hcl`
del repositorio no cambió.

`terraform destroy` en `infra/bootstrap` no se ejecutó. El bucket de estado
tiene `prevent_destroy` y su borrado queda a decisión de la persona
responsable de la cuenta. Al cierre de esta evidencia contiene únicamente el
estado vacío de `findly/sandbox`.

## Ejecución real en AWS Learner Lab (cuenta con rol `voclabs`, `us-east-1`)

Desviación de región documentada: ADR-004 fija `eu-west-1`, pero el Learner Lab
sólo permite crear buckets en `us-east-1`/`us-west-2`; se usó `us-east-1` sólo
para esta verificación.

- `infra/bootstrap`: `plan` = 6 a crear. El `apply` en `eu-west-1` falló con
  `AccessDenied` (deny explícito de política de identidad en `s3:CreateBucket`).
  En `us-east-1` el bucket `findly-tfstate-<cuenta>` se creó, pero el `apply`
  falló al leer `GetBucketObjectLockConfiguration` (deny explícito de una SCP
  de la organización). Los otros 5 recursos (versionado, SSE, bloqueo público,
  política TLS, ciclo de vida) **no se aplicaron**: el bootstrap completo no está
  verificado y el bucket quedó sin gestionar por Terraform.
- `environments/sandbox`: `init` con ese bucket como backend (lockfile S3) y
  `plan`: `Plan: 38 to add, 0 to change, 0 to destroy`; 34 recursos con
  etiqueta `Environment = "sandbox"`. No se hizo `apply` del sandbox.

<!-- requirement: REQ-REMOTE-STATE -->
