# 5. Implementación y CI/CD

La aplicación React + Vite empaqueta las Lambdas con esbuild y Terraform
describe los recursos serverless. CI ejecuta las validaciones estáticas y una
prueba E2E local con Floci. Para cada pull request interno, un workflow separado
asume un rol AWS temporal mediante GitHub OIDC, usa estado remoto aislado por
número de PR, aprovisiona `infra/ephemeral`, prueba el API, Cognito y S3
desplegados con datos sintéticos y ejecuta `destroy` incluso después de un fallo
de prueba. Floci no se ejecuta en ese workflow: queda en el job E2E local, que
restaura los binarios de Playwright desde una caché por SO y lockfile. La
configuración de la cuenta y del backend no reside en Git: se documenta en
`docs/runbooks/ephemeral-pr-ci-external-setup.md`.

## Trazabilidad auditada

La [matriz de cierres](../evidence/issue-checklist-audit.md) registra commit,
PR y run de cada evidencia. El cliente público HTTP de #22 está entregado;
los endpoints, recorrido de inscripción AWS y demo publicada conservan sus
criterios pendientes. La CI verde valida sólo los módulos que despliega.
