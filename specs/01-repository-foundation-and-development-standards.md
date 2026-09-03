# 01 - Fundación del repositorio y estándares de desarrollo

## Objetivo
Establecer y mantener una base de código reproducible, robusta y con calidad automatizada para un equipo multidisciplinar de 4 contribuidores utilizando React + Vite.

## Alineación con AWS Well-Architected Framework
- **Excelencia Operativa**: Estandarización de herramientas de linting, tipado estricto en TypeScript y scripts de verificación automatizados (`npm run verify`).
- **Seguridad**: Prohibición de guardar credenciales o secretos en Git; uso de `.env.example` y `terraform.tfvars.example`.

## Requisitos Técnicos y Estándares Cloud

### Entorno y Herramientas Base
- **Runtime**: Node.js 24.x LTS.
- **Lenguaje**: TypeScript en modo estricto (`strict: true`, `noImplicitAny: true`).
- **Framework Web**: React 18+ empaquetado con **Vite** (generación estática SPA en `dist/`).
- **Testing**:
  - Unitario / Integración: Vitest con `@testing-library/react` y `aws-sdk-client-mock`.
  - End-to-End (E2E): Playwright con soporte para navegadores Chromium, Firefox y WebKit.
- **Linter y Formateador**: ESLint 9+ (sin desactivar reglas de calidad) y Prettier.
- **IaC Linting & Format**: `terraform fmt -check`, `terraform validate` y `tflint`.
- **Markdown & Infrastructure Linting**: Markdownlint para documentación y `actionlint` para GitHub Actions.
- **Commits**: Convención de Commits Tradicionales (Conventional Commits) validada vía `commitlint` y Git hooks (`husky`).

### Comandos de Verificación
El archivo `package.json` debe exponer los siguientes comandos unificados:
- `npm run lint`: Ejecuta ESLint, Markdownlint y `tflint`.
- `npm run test`: Ejecuta Vitest en modo CI con reporte de cobertura.
- `npm run test:e2e`: Ejecuta la suite de Playwright.
- `npm run build`: Compila la aplicación React + Vite en `dist/` y verifica paquetes Lambda.
- `npm run verify`: Pipeline local completo que ejecuta lint, tipos, pruebas unitarias y build sin errores.

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Configurar Node y Vite
- Verifica que usas Node 24 (`node -v`).
- Inicializa el proyecto con Vite si es necesario o ajusta `vite.config.ts` para que la salida de compilación sea la carpeta `dist/`.

### Paso 2: Configurar Linters y Git Hooks
- Asegúrate de que `husky` está instalado y que el hook `commit-msg` ejecuta `npx --no -- commitlint --edit $1`.
- Verifica que no existen reglas de ESLint deshabilitadas mediante comentarios `// eslint-disable`.

### Paso 3: Probar la Verificación Local
- Ejecuta `npm run verify` en la terminal. Todos los pasos deben finalizar con éxito en verde.

## Errores Comunes a Evitar (Pitfalls)
- ❌ **ERROR**: Subir por error el archivo `.env` o credenciales de AWS al repositorio.
  - *Solución*: Asegúrate de que `.env`, `.env.local` y `*.tfstate` están incluidos en el `.gitignore`.
- ❌ **ERROR**: Utilizar `any` en las declaraciones de TypeScript para atajar errores de compilación.
  - *Solución*: Define las interfaces o tipos genéricos adecuados. El modo estricto rechazará el uso de `any`.

## Lista de Verificación Pre-PR (Junior Checklist)
- [x] `npm run verify` se ejecuta localmente y finaliza en verde sin advertencias.
- [x] No se incluyen comentarios en código que expliquen "QUÉ" hace la función (solo explicaciones de decisiones no obvias de "POR QUÉ").
- [x] Ningún secreto ni archivo `.env` ha sido incluido en el commit.
