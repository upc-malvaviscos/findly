# 15 - Destrucción programada de entornos no productivos (Teardown)

## Objetivo
Garantizar la política de FinOps de coste cero eliminando periódicamente mediante automatizaciones programadas todos los recursos desplegados en los entornos temporales de desarrollo (`sandbox` / `development`), garantizando que los entornos de `demo` y `production` queden totalmente protegidos.

## Requisitos de Automatización (`.github/workflows/scheduled-teardown.yml`)

### Frecuencia y Disparo
- Programación mediante Cron de GitHub Actions ejecutado cada 12 horas (`0 */12 * * *`) y disponible para ejecución manual vía `workflow_dispatch`.

### Reglas Estrictas de Teardown
1. Filtrado de Entorno: Iterar única y exclusivamente sobre los estados de `sandbox` o `development`.
2. Vaciado de Buckets S3: Ejecutar scripts de vaciado previo para los buckets que contengan el sufijo o tag exclusivo del entorno objetivo.
3. Ejecución de Destrucción: `terraform destroy -auto-approve -var="allow_bucket_destroy=true"`.
4. Preservación del Bootstrap: El bucket de estado remoto de Terraform y la tabla de bloqueo DynamoDB nunca son eliminados por esta automatización.
5. Verificación de Destrucción: Consulta vía AWS CLI para comprobar que la API Gateway, Lambdas, DynamoDB y buckets de S3 del entorno de desarrollo han sido eliminados por completo.

## Criterios de Aceptación
- Una ejecución completa del teardown demuestra la eliminación de todos los recursos no productivos sin afectar al entorno de `demo` ni a `production`.
- La comprobación `dry-run` enumera con precisión los recursos a destruir antes de su ejecución real.
