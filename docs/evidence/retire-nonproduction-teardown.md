# Retirada del handoff de limpieza programada

<!-- requirement: REQ-RETIRED-TEARDOWN-HANDOFF -->

Fecha: 2026-10-25. Seguimiento de
[#16](https://github.com/upc-malvaviscos/findly/issues/16), spec 15 y ADR-008.

## Alcance

Se elimina `.github/workflows/teardown-nonproduction.yml`, que sólo hacía
checkout y mostraba un aviso cada doce horas o al ejecutarse manualmente.
La retirada fue solicitada por el responsable tras revisar el inventario de
workflows. No tenía pasos de limpieza ni configuraba credenciales AWS.

Se sincronizan las specs 14 y 15, el capítulo de CI/CD y la trazabilidad.
Se conservan `ephemeral-pr-e2e.yml`, su paso `Destroy the PR environment`
con `always()`, y `destroy-demo.yml` con confirmación manual.
La decisión continúa ADR-008 y no introduce una arquitectura nueva.

## Verificación reproducible

```sh
test ! -e .github/workflows/teardown-nonproduction.yml
git diff --exit-code origin/main -- .github/workflows/ephemeral-pr-e2e.yml .github/workflows/destroy-demo.yml
npm run harness:check
npm run lint:workflows
npm run verify
```

Resultados locales: `harness:check`, lint (incluido actionlint y TFLint),
tipos, 760 pruebas unitarias, build y contratos Terraform con proveedor
simulado (20 casos) correctos; `security` sin vulnerabilidades y `sync:check`
con 20 requisitos válidos. La comprobación de secretos enumera el índice de
Git: la retirada debe estar staged para no intentar leer el archivo eliminado.
El hook de pre-push ejecuta nuevamente `harness:check` y `verify` completos.
No se añade una prueba de aplicación ni se cambia un recorrido de usuario.

La PR usa la excepción existente `skip-ephemeral-approved`: eliminar este
aviso y sincronizar documentación no necesita aprovisionar AWS. Los checks
obligatorios se conservan; el check efímero registra la omisión del despliegue.
Estas verificaciones no acreditan un despliegue, una destrucción ni cambios IAM.

El workflow registrado con ID `349423397` se deshabilitó mediante GitHub CLI.
La lectura posterior de la API devolvió `state: disabled_manually` para
`Non-production teardown handoff`. Esto detiene la programación mientras se
integra la eliminación del archivo en `main`; el historial anterior puede
seguir visible en GitHub. No se han deshabilitado otros workflows.
