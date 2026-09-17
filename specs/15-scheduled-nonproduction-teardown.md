# 15 - Entorno efímero de pull request y destrucción garantizada

## Objetivo

Sustituir la limpieza programada compartida por un entorno AWS exclusivo de
cada pull request. El workflow lo crea mediante Terraform, ejecuta el recorrido
del organizador contra Floci y lo destruye en un paso `always()`, incluso cuando
fallan las pruebas. No existe cron ni una ruta que pueda destruir `demo` o
`production`.

## Criterios de aceptación

- `.github/workflows/ephemeral-pr-e2e.yml` sólo se ejecuta para PRs no draft
  cuya rama pertenece al repositorio; no usa `pull_request_target`.
- La identidad es OIDC, con `id-token: write`; no hay claves AWS ni secretos
  de larga duración en el repositorio o el workflow.
- El estado remoto usa S3 cifrado, bloqueo nativo y una clave
  `ephemeral/pr-<numero>/terraform.tfstate`; la concurrencia evita dos runs del
  mismo PR a la vez.
- `infra/ephemeral` sólo admite un número de PR positivo, etiqueta todos los
  recursos y usa `force_destroy` exclusivamente para su bucket efímero.
- La destrucción se intenta después de cualquier fallo posterior a la asunción
  del rol. El bucket se vacía como parte de Terraform, sin un script que acepte
  nombres de entornos arbitrarios.
- El recorrido Playwright local autentica al organizador simulado, crea y
  selecciona un evento y carga una JPEG sintética al S3 emulado por Floci.

## Límites de coste y seguridad

El stack usa DynamoDB bajo demanda, S3 privado, API Gateway HTTP, Lambda y un
User Pool de Cognito. No crea VPC, NAT, EC2, RDS ni recursos permanentes. Sus
datos son sintéticos y se etiquetan `Ephemeral=true` y `PullRequest=<numero>`.
La configuración de cuenta, rol y backend se hace fuera del repositorio según
el runbook; desarrollo local no ejecuta `terraform apply`.
