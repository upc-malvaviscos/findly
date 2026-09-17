# ADR-008: CI efímera por pull request con OIDC y estado remoto aislado

## Contexto

Una limpieza cada doce horas deja una ventana de coste y comparte el riesgo de
destrucción entre entornos. El flujo necesita comprobar en navegador el trabajo
del organizador sin almacenar credenciales AWS.

## Decisión

Cada PR interno no draft usa un rol OIDC limitado, un backend S3 cifrado y la
clave de estado `ephemeral/pr-<numero>/terraform.tfstate`. Terraform sólo
acepta números de PR y nombra y etiqueta los recursos con `pr-<numero>`. El
workflow serializa ejecuciones del mismo PR y ejecuta `destroy` con `always()`.
Floci sigue siendo la dependencia local de E2E: los handlers reales de eventos
y prefirmado se ejercitan contra DynamoDB y S3 emulados con datos sintéticos.

## Consecuencias

La cuenta requiere una configuración única descrita fuera del código: bucket de
estado y dos variables GitHub no secretas. Un fallo de provisioning o pruebas
puede dejar recursos sólo si AWS o GitHub impiden el paso final; el runbook
incluye la recuperación PR-específica. No se concede acceso OIDC a forks.
