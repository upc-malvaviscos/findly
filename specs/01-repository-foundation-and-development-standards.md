# 01 - Fundación del repositorio

## Objetivo
Mantener una base reproducible para cuatro contribuidores.

## Requisitos
- Configurar Node 22, TypeScript estricto, ESLint, Vitest, Playwright, Markdownlint y Conventional Commits.
- Documentar variables mediante `.env.example`; prohibir secretos y estados Terraform en Git.
- Añadir comandos únicos para verificar web, Lambdas e infraestructura.

## Aceptación
Un clon limpio instala dependencias y ejecuta `npm run verify` sin editar archivos.
