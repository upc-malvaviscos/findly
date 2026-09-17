# ADR-008: CI efímera por pull request con OIDC y estado remoto aislado

## Contexto

Una limpieza cada doce horas deja una ventana de coste y comparte el riesgo de
destrucción entre entornos. El flujo necesita comprobar en navegador el trabajo
del organizador sin almacenar credenciales AWS.

## Decisión

GitHub Actions se autentica exclusivamente mediante el proveedor AWS OIDC y
credenciales temporales de `AssumeRoleWithWebIdentity`; no se guardan access
keys, tokens AWS ni perfiles en GitHub. Cada PR interno no draft asume el rol
`findly-github-ephemeral-pr-ci`, un backend S3 cifrado y la clave de estado
`ephemeral/pr-<numero>/terraform.tfstate`. Terraform sólo acepta números de PR
y nombra y etiqueta los recursos con `pr-<numero>`. El workflow serializa
ejecuciones del mismo PR y ejecuta `destroy` con `always()`.

La frontera de confianza del rol exige exactamente el audience
`sts.amazonaws.com` y el subject
`repo:upc-malvaviscos/findly:pull_request`. No autoriza ramas, GitHub
environments, otros repositorios ni forks. Floci sigue siendo la dependencia
local de E2E: los handlers reales de eventos y prefirmado se ejercitan contra
DynamoDB y S3 emulados con datos sintéticos.

## Alternativa rechazada

Se rechazan `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, tokens de sesión
persistidos y perfiles AWS configurados como GitHub secrets. Aunque permitirían
el mismo apply, amplían la vida, distribución y superficie de revocación de las
credenciales, y no vinculan la asunción a una ejecución concreta de PR.

## Consecuencias

La cuenta requiere una configuración única descrita fuera del código: bucket de
estado, proveedor OIDC, rol limitado y dos variables GitHub no secretas. Un
fallo de provisioning o pruebas puede dejar recursos sólo si AWS o GitHub
impiden el paso final; el runbook incluye la recuperación PR-específica. El
operador rota o revoca acceso cambiando la policy o trust del rol, no secretos
distribuidos. No se concede acceso OIDC a forks.
