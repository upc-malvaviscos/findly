# 13 - Integración continua (CI), puertas de calidad y publicación de artefactos

## Objetivo
Configurar pipelines automatizados en GitHub Actions para validar la calidad del código, verificar la sintaxis de infraestructura Terraform con caché de dependencias y publicar artefactos probados antes de integrar en la rama principal.

## Alineación con AWS Well-Architected Framework
- **Excelencia Operativa**: Puertas de calidad automatizadas mediante matriz de trabajos paralelos (`job_lint`, `job_types`, `job_unit_tests`, `job_e2e_tests`, `job_terraform`), caching de dependencias y empaquetado zip de Lambdas.

## Requisitos del Pipeline de CI (`.github/workflows/ci.yml`)
- Caching con `actions/cache@v4` para dependencias Node.
- Matriz de validación: Linting (ESLint, Markdownlint, `tflint`, `actionlint`), comprobación de tipos, tests Vitest, E2E Playwright y empaquetado Lambda.
- Publicación de artefactos `dist/` e informes de cobertura.

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Crear la Estructura del Workflow
- En `.github/workflows/ci.yml`, configura el disparo `on: [push, pull_request]`.

### Paso 2: Implementar la Matriz de Trabajos
- Define trabajos paralelos independientes para acelerar el pipeline de CI.
- Añade el paso de caching con `actions/cache@v4`.

## Errores Comunes a Evitar (Pitfalls)
- ❌ **ERROR**: Olvidar instalar o validar `tflint` en el pipeline de CI.
  - *Solución*: Asegúrate de ejecutar `tflint` para detectar errores de sintaxis y buenas prácticas en Terraform antes del merge.
- ❌ **ERROR**: Hacer que todos los trabajos se ejecuten de forma secuencial lenta.
  - *Solución*: Declara trabajos (`jobs`) independientes para aprovechar el paralelismo de GitHub Actions.

## Lista de Verificación Pre-PR (Junior Checklist)
- [ ] El pipeline de CI se ejecuta en paralelo y completa en menos de 3 minutos.
- [ ] La compilación estática de React + Vite en `dist/` se sube como artefacto de CI.
- [ ] `actionlint` no detecta sintaxis inválida en los workflows YAML.
