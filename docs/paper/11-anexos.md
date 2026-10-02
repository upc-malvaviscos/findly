# 11. Anexos

## A. Variables no sensibles por entorno

`infra/environments/{sandbox,demo,production}/terraform.tfvars` se versiona
porque sólo contiene valores no sensibles; un test estático rechaza secretos
en ellos (`tests/infra/terraformEnvironments.test.ts`).

| Variable              | Ejemplo (`sandbox`)                     | Notas                                                     |
| --------------------- | --------------------------------------- | --------------------------------------------------------- |
| `aws_region`          | `eu-west-1`                             | Única región (ADR-004).                                   |
| `project`             | `findly`                                | Etiqueta `Project`.                                       |
| `cost_center`         | `findly`                                | Etiqueta `CostCenter`.                                    |
| `data_class`          | `synthetic`                             | Etiqueta `DataClass`; `biometric` en `demo`/`production`. |
| `frontend_domain_url` | `http://127.0.0.1:5173`                 | Origen exacto autorizado por CORS y S3.                   |
| `uploads_bucket_name` | `findly-sandbox-<ACCOUNT_ID>-eu-west-1` | Nombre globalmente único; se sustituye al aplicar.        |
| `alert_email`         | _(sin valor por defecto)_               | Sensible; se pasa con `TF_VAR_alert_email`, nunca en Git. |
| `enable_budget`       | `true` sólo en `sandbox`                | El presupuesto es de ámbito de cuenta (issue #13).        |

Ninguna credencial AWS se versiona: la autenticación es OIDC federado
(ADR-008) o una sesión temporal exportada sólo a los subprocesos de Terraform
(`docs/execution-modes.md`).

## B. Comandos de despliegue y verificación

```sh
# Validación local completa (sin AWS)
npm ci
npm run harness:check
npm run verify

# E2E
npm run test:e2e
npm run test:e2e:local

# Terraform, por root
terraform -chdir=infra/environments/sandbox init -backend-config="bucket=<estado>" ...
terraform -chdir=infra/environments/sandbox plan
node scripts/terraform-lint.mjs

# Sandbox AWS real (requiere bucket de estado aplicado con infra/bootstrap)
FINDLY_TERRAFORM_STATE_BUCKET=<bucket> npm run dev:aws
FINDLY_TERRAFORM_STATE_BUCKET=<bucket> npm run dev:aws-destroy -- --confirm
```

`npm run dev:aws` aplica exclusivamente `infra/environments/sandbox`, crea un
usuario Cognito sintético de un solo uso y nunca escribe credenciales ni
salidas en el repositorio.

## C. Salidas de Terraform (nombres, sin valores)

`infra/environments/{sandbox,demo,production}` exponen, entre otras:
`api_endpoint`, `api_id`, `table_name`, `uploads_bucket_name`,
`cognito_user_pool_id`, `cognito_client_id`, `gallery_reader_function_name`,
`public_function_names`, `selfie_indexer_function_name`,
`delete_registration_function_name`, `retention_purger_function_name`,
`web_bucket_name`, `web_distribution_id`, `web_distribution_domain_name`,
`alerts_topic_arn` y `collection_namespace`. `infra/bootstrap` expone
`state_bucket_name`. Ningún output publica un secreto o credencial.

## D. Matriz de coste (orden de magnitud, no verificado)

`docs/evidence/issue-49-dynamodb-vs-rds-analysis.md` (sección 3) detalla la
comparación completa frente a RDS. Resumen de la arquitectura elegida:

| Recurso                          | Modelo de coste                          | Coste fijo |
| -------------------------------- | ---------------------------------------- | ---------- |
| DynamoDB on-demand               | Por petición y GB almacenado             | No         |
| S3 (selfies, fotos, web, estado) | Por GB y petición                        | No         |
| Lambda                           | Por invocación y duración                | No         |
| API Gateway HTTP                 | Por petición                             | No         |
| SQS + DLQ                        | Por petición                             | No         |
| Rekognition                      | Por imagen procesada                     | No         |
| CloudWatch Logs (retención 14 d) | Por GB ingerido y almacenado             | No         |
| EventBridge Scheduler            | Por invocación programada                | No         |
| AWS Budgets                      | Gratuito hasta un número de presupuestos | No         |

Ningún recurso de la lista tiene coste por hora. Los importes exactos no están
verificados en esta entrega (sección "Orden de magnitud de coste" del análisis
de la issue #49); deben confirmarse con AWS Pricing Calculator antes de
presupuestar.

## E. Runbook de demostración

El procedimiento paso a paso por niveles, con lo que es ejecutable hoy y lo
que sigue bloqueado, está en
[`docs/runbooks/demo-runbook.md`](../runbooks/demo-runbook.md). La guía
exhaustiva de despliegue en AWS real mediante Terraform — cada comando,
desde el bootstrap del estado hasta el recorrido manual completo de la
demo — está en
[`docs/runbooks/aws-deployment-guide.md`](../runbooks/aws-deployment-guide.md).

## F. Evidencia adicional

- Auditoría de cierres: [`docs/evidence/issue-checklist-audit.md`](../evidence/issue-checklist-audit.md).
- Aceptación AWS de #70: [`docs/evidence/issue-70-integration.md`](../evidence/issue-70-integration.md),
  [`docs/runbooks/issue-70-acceptance.md`](../runbooks/issue-70-acceptance.md),
  [`docs/runbooks/issue-70-aws-review.md`](../runbooks/issue-70-aws-review.md).
- Observabilidad y FinOps: [`docs/evidence/issue-13-observability-finops.md`](../evidence/issue-13-observability-finops.md).
- Decisión DynamoDB/RDS: [`docs/evidence/issue-49-dynamodb-vs-rds-analysis.md`](../evidence/issue-49-dynamodb-vs-rds-analysis.md).
- Estado remoto de Terraform: [`docs/evidence/issue-11-terraform-remote-state.md`](../evidence/issue-11-terraform-remote-state.md).
