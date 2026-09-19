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

| Criterio                                                   | Estado                                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fmt`, `validate` y `tflint` en verde                      | Demostrado (comandos anteriores).                                                                                                                    |
| `terraform.tfvars` sin secretos                            | Demostrado por test estático.                                                                                                                        |
| El plan de `sandbox` no interfiere con `demo`/`production` | `plan` real de sandbox (abajo): 38 a crear, 0 a destruir, clave de estado propia y `Environment=sandbox`. No se ejecutó plan de `demo`/`production`. |
| Bootstrap del bucket de estado en `eu-west-1`              | **Pendiente** (#61): el rol `voclabs` deniega `s3:CreateBucket` fuera de `us-east-1`/`us-west-2`.                                                    |
| Migración del estado sandbox sin destroy (`moved`)         | **Pendiente** (#61): no existía estado previo en la cuenta.                                                                                          |

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
