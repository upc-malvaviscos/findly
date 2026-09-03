# 13 - Integración continua (CI), puertas de calidad y publicación de artefactos

## Objetivo
Configurar pipelines automatizados en GitHub Actions para validar la calidad del código, verificar la sintaxis de infraestructura Terraform con caché de dependencias y publicar artefactos probados antes de integrar en la rama principal.

## Requisitos del Pipeline de CI (`.github/workflows/ci.yml`)

### Estrategia de Caché de Dependencias
```yaml
- uses: actions/cache@v4
  with:
    path: ~/.npm
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
```

### Trabajos Paralelos (Quality Gates)
1. **Validación de Commits y Sintaxis (`job_lint`)**: `commitlint`, `actionlint` y `markdownlint`.
2. **Análisis Estático y Tipos (`job_types`)**: ESLint en modo estricto y chequeo de tipos TypeScript (`tsc --noEmit`).
3. **Pruebas Unitarias e Integración (`job_unit_tests`)**: Vitest con `aws-sdk-client-mock` y reporte de cobertura.
4. **Pruebas E2E (`job_e2e_tests`)**: Suite de Playwright ejecutada contra el build estático.
5. **Validación de Infraestructura (`job_terraform`)**: `terraform fmt -check`, `terraform validate` y `tflint`.
6. **Empaquetado Lambda (`job_package`)**: Verificación de empaquetado de artefactos `.zip` para funciones Lambda.

### Publicación de Artefactos de CI
- Publicar el build estático `out/` como artefacto descargable en GitHub Actions.
- Guardar reportes de cobertura de código y resultados de Playwright HTML para trazabilidad y auditoría.

## Criterios de Aceptación
- Una Pull Request con errores de lint, tipos o pruebas fallidas es bloqueada automáticamente por las puertas de calidad de GitHub.
- Los artefactos generados son reproducibles y descargables desde el resumen de la ejecución del workflow en GitHub Actions.
