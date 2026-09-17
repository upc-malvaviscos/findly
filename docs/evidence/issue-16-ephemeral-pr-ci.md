# Evidencia reproducible: issue 16

## Alcance implementado

- Root Terraform `infra/ephemeral` aislado por número de PR, con nombres,
  etiquetas y bucket que Terraform puede vaciar sólo en CI efímera.
- Workflow OIDC de PR con estado S3 cifrado/bloqueado, concurrencia por PR y
  `destroy` condicionado con `always()`, con un recorrido AWS real entre ambos
  pasos: usuario Cognito temporal, API Gateway/Lambda, DynamoDB y subida S3
  prefirmada de JPEG sintética.
- Recorrido Playwright-Floci local en el job E2E independiente, con caché de
  `~/.cache/ms-playwright` por SO y `package-lock.json`.

## Validación local prevista

```text
npm run lint:workflows
terraform -chdir=infra/ephemeral init -backend=false -input=false
terraform -chdir=infra/ephemeral validate
npm run test:e2e:local -- --project=chromium
node --check scripts/deployed-ephemeral-happy-path.mjs
```

No se ejecuta `terraform apply` local. La ejecución remota usa el rol OIDC y
backend configurados según el runbook externo; su resultado queda registrado en
los checks de la pull request.
