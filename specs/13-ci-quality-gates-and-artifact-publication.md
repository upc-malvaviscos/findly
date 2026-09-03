# 13 - CI y artefactos

## Objetivo
Bloquear regresiones antes de integrar cambios.

## Requisitos
- Ejecutar commitlint, ESLint, TypeScript, Vitest, Playwright, Markdownlint, actionlint, Terraform fmt/validate y empaquetado Lambda.
- Publicar `out/`, zips Lambda y documentación como artefactos versionados de GitHub Actions.
- Fallar ante YAML inválido, Markdown sin formato o infraestructura sin validar.

## Aceptación
Una PR defectuosa falla en la puerta correspondiente y una PR válida conserva artefactos descargables.
