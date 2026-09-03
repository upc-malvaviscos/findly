# 15 - Destrucción programada de entornos no productivos (Teardown)

## Objetivo
Garantizar la política de FinOps de coste cero eliminando periódicamente mediante automatizaciones programadas todos los recursos desplegados en los entornos temporales de desarrollo (`sandbox` / `development`), incluyendo el vaciado previo de buckets S3 y la verificación técnica post-destrucción, garantizando la protección de los entornos de `demo` y `production`.

## Alineación con AWS Well-Architected Framework
- **Optimización de Costes (FinOps)**: Purga programada cada 12 horas para mantener la infraestructura no productiva en coste $0.
- **Excelencia Operativa**: Guardas de seguridad automatizadas que impiden la destrucción en `demo` o `production`.

## Requisitos de Automatización (`.github/workflows/scheduled-teardown.yml`)
- Cron de GitHub Actions (`0 */12 * * *`) y disparo manual `workflow_dispatch`.
- Script Bash `scripts/empty-buckets.sh` para vaciar objetos en S3 antes de invocar `terraform destroy`.
- Ejecución `terraform destroy -auto-approve -var="allow_bucket_destroy=true"`.
- Script Bash `scripts/verify-teardown.sh` para comprobar cero recursos residuales.

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Crear el Script de Pre-vaciado S3 (`scripts/empty-buckets.sh`)
- En el script, incluye una guarda explícita que aborte la ejecución si el argumento no es `sandbox` o `development`.

### Paso 2: Crear el Script de Verificación (`scripts/verify-teardown.sh`)
- Usa la AWS CLI (`aws lambda list-functions`, `aws apigatewayv2 get-apis`) para comprobar que no quedan recursos con la etiqueta `Environment = sandbox`.

## Errores Comunes a Evitar (Pitfalls)
- ❌ **ERROR**: Permitir que `empty-buckets.sh` acepte por error la cadena `production`.
  - *Solución*: Implementa una validación `if` estricta que solo acepte `sandbox` o `development`.
- ❌ **ERROR**: Olvidar preservar la tabla de bloqueo DynamoDB `findly-tflock` o el bucket de estado `.tfstate`.
  - *Solución*: La infraestructura de bootstrap está en un estado Terraform independiente que nunca se destruye.

## Lista de Verificación Pre-PR (Junior Checklist)
- [ ] El script de vaciado falla limpiamente si se invoca con `demo` o `production`.
- [ ] `terraform destroy` se completa sin errores de S3 bucket no vacío.
- [ ] La verificación posterior confirma la destrucción total de recursos de desarrollo.
