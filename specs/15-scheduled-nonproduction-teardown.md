# 15 - Destrucción programada de entornos no productivos (Teardown)

## Objetivo
Garantizar la política de FinOps de coste cero eliminando periódicamente mediante automatizaciones programadas todos los recursos desplegados en los entornos temporales de desarrollo (`sandbox` / `development`), incluyendo el vaciado previo de buckets S3 y la verificación técnica post-destrucción, garantizando la protección de los entornos de `demo` y `production`.

## Requisitos de Automatización (`.github/workflows/scheduled-teardown.yml`)

### Frecuencia y Disparo
- Programación mediante Cron de GitHub Actions ejecutado cada 12 horas (`0 */12 * * *`) y disponible para ejecución manual vía `workflow_dispatch`.

### Guardas de Seguridad contra Errores
- Comprobación estricta de entorno: Si el objetivo es `demo` o `production`, la ejecución se aborta de inmediato.

### Script Bash de Pre-Vaciado de Buckets S3 (`scripts/empty-buckets.sh`)
```bash
set -e

ENV=$1
if [ "$ENV" != "sandbox" ] && [ "$ENV" != "development" ]; then
  echo "Error: Solo se permite vaciar entornos no productivos"
  exit 1
fi

BUCKETS=$(aws s3api list-buckets --query "Buckets[?contains(Name, 'findly') && contains(Name, '$ENV')].Name" --output text)

for BUCKET in $BUCKETS; do
  echo "Vaciando bucket $BUCKET..."
  aws s3 rm "s3://$BUCKET" --recursive
done
```

### Reglas Estrictas de Teardown
1. Ejecutar `scripts/empty-buckets.sh sandbox` antes de invocar Terraform.
2. Ejecución de Destrucción: `terraform destroy -auto-approve -var="allow_bucket_destroy=true"`.
3. Preservación del Bootstrap: El bucket de estado remoto de Terraform y la tabla de bloqueo DynamoDB nunca son eliminados por esta automatización.

### Script Bash de Post-Verificación (`scripts/verify-teardown.sh`)
- Comprobación vía AWS CLI (`aws apigatewayv2 get-apis`, `aws lambda list-functions`, `aws dynamodb list-tables`, `aws sqs list-queues`) confirmando que no quedan recursos residuales en la región para ese entorno.

## Criterios de Aceptación
- Una ejecución completa del teardown demuestra la eliminación de todos los recursos no productivos sin afectar al entorno de `demo` ni a `production`.
- La comprobación `dry-run` enumera con precisión los recursos a destruir antes de su ejecución real.
