# Base de infraestructura compartida para #5 y #9

## Alcance

- Tabla DynamoDB on-demand con TTL, SSE, GSI1 facial y GSI2 para eventos.
- Bucket de subidas privado y API HTTP genérica compuestos desde el root
  Terraform.
- API Gateway mantiene únicamente API, stage y CORS; las rutas de #5 y #9 se
  entregan en sus respectivas PRs.

## Validación reproducible

```text
terraform -chdir=infra fmt -check -recursive  PASS
terraform -chdir=infra validate                PASS
tflint --chdir=infra                           PASS
vitest tests/shared/dynamoKeys.test.ts         PASS (16 tests)
```

No se ejecutó `terraform apply` ni se provisionaron recursos AWS.

El backend remoto, bloqueo de estado y directorios por entorno de spec 10 no
forman parte de esta base; siguen siendo una dependencia explícita antes de
una aplicación gestionada.
