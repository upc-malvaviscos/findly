# 5. Implementación y CI/CD

La aplicación React + Vite empaqueta las Lambdas con esbuild y Terraform
describe los recursos serverless. CI ejecuta las validaciones estáticas y una
prueba E2E local con Floci. Para cada pull request interno, un workflow separado
asume un rol AWS temporal mediante GitHub OIDC, usa estado remoto aislado por
número de PR, aprovisiona `infra/ephemeral` y ejecuta `destroy` incluso después
de un fallo de prueba. La configuración de la cuenta y del backend no reside en
Git: se documenta en `docs/runbooks/ephemeral-pr-ci-external-setup.md`.
