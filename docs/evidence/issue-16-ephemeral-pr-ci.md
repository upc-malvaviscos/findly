# Evidencia reproducible: issue 16

## Alcance implementado

- Root Terraform `infra/ephemeral` aislado por número de PR, con nombres,
  etiquetas y bucket que Terraform puede vaciar sólo en CI efímera.
- Workflow OIDC de PR con estado S3 cifrado/bloqueado, concurrencia por PR y
  `destroy` condicionado con `always()`.
- Recorrido Playwright-Floci para login simulado, creación/selección de evento
  y subida JPEG sintética mediante los handlers de producción.

## Validación local prevista

```text
npm run lint:workflows
terraform -chdir=infra/ephemeral init -backend=false -input=false
terraform -chdir=infra/ephemeral validate
npm run test:e2e:local -- --project=chromium
```

No se ejecuta `terraform apply` local ni se aprovisiona AWS. La ejecución remota
permanece bloqueada hasta que el responsable configure el rol OIDC y backend
indicados en el runbook externo.
