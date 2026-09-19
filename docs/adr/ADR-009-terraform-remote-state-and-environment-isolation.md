# ADR-009: Estado remoto S3 con lockfile nativo y raíces Terraform por entorno

## Contexto

La spec 10 (issue #11) pedía un backend S3 con tabla DynamoDB `findly-tflock` y
carpetas `infra/environments/{sandbox,demo,production}`. El repositorio ya
usaba un backend S3 parcial con `use_lockfile=true` (sandbox, CI efímero,
ADR-008) y un único root `infra/` parametrizado por `environment`, de modo que
un valor erróneo podía apuntar el estado de un entorno a otro.

## Decisión

- **Bloqueo:** se mantiene el lockfile nativo de S3 (`use_lockfile=true`). No se
  crea la tabla `findly-tflock`: evita un recurso extra, sigue el estándar del
  resto del repositorio y del CI efímero, y no cambia la garantía de exclusión
  concurrente. Es una desviación consciente de la spec, que se actualiza.
- **Aislamiento:** `infra/modules/findly-stack` contiene el stack compartido y
  cada `infra/environments/<env>` es un root fino con su propia clave de estado
  (`findly/<env>/terraform.tfstate`), su `environment` fijado en un `local` (no
  configurable por tfvars) y `default_tags` completos. `allow_bucket_destroy`
  es `true` sólo en `sandbox`; por defecto y en `demo`/`production` es `false`.
- **Bootstrap:** `infra/bootstrap` crea `findly-tfstate-<account_id>` con
  versionado, SSE-S3, bloqueo de acceso público, política TLS-only, caducidad de
  versiones no actuales a 90 días y `prevent_destroy`. Usa estado local y lo
  aplica una vez una persona administradora; ningún flujo automático lo aplica.
- `infra/ephemeral` permanece independiente (ADR-008) con su propia clave
  `ephemeral/pr-<n>/terraform.tfstate`.
- Los `terraform.tfvars` por entorno se versionan porque sólo contienen valores
  no sensibles; un test estático rechaza secretos en ellos.
- `terraform validate` se ejecuta con un `backend_override.tf` temporal
  (`scripts/terraform-validate.mjs`) porque Terraform 1.15 exige `bucket` y
  `key` incluso con `init -backend=false`.

## Consecuencias

El estado sandbox existente usaba direcciones en la raíz; los bloques `moved`
del root sandbox las reubican bajo `module.findly` sin recrear recursos. Esa
ausencia de destroy/replace debe confirmarse con `terraform plan` real antes de
aplicar (véase `docs/evidence/issue-11-terraform-remote-state.md`).
