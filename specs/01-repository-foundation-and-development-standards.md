# 01 - Fundación del repositorio y estándares de desarrollo

## Objetivo
Establecer y mantener una base de código reproducible, robusta y con calidad automatizada para un equipo multidisciplinar de 4 contribuidores.

## Requisitos Técnicos

### Entorno y Herramientas Base
- **Runtime**: Node.js 22.x LTS.
- **Lenguaje**: TypeScript en modo estricto (`strict: true`, `noImplicitAny: true`).
- **Framework Web**: Next.js (configurado con `output: export` para sitio estático sin servidor Node).
- **Testing**:
  - Unitario / Integración: Vitest con React Testing Library.
  - End-to-End (E2E): Playwright con soporte para navegadores Chromium, Firefox y WebKit.
- **Linter y Formateador**: ESLint 9+ (sin desactivar reglas de calidad) y Prettier.
- **Markdown & Infrastructure Linting**: Markdownlint para documentación y `actionlint` para GitHub Actions.
- **Commits**: Convención de Commits Tradicionales (Conventional Commits) validada vía `commitlint` y Git hooks (`husky`).

### Seguridad y Secretos
- Prohibición absoluta de almacenar secretos, claves API de AWS o archivos `.tfstate` en el control de versiones.
- Documentar todas las variables del entorno mediante `.env.example`.

### Comandos de Verificación
El archivo `package.json` debe exponer los siguientes comandos unificados:
- `npm run lint`: Ejecuta ESLint y Markdownlint.
- `npm run test`: Ejecuta Vitest en modo CI.
- `npm run test:e2e`: Ejecuta la suite de Playwright.
- `npm run build`: Compila la aplicación Next.js en `out/` y verifica paquetes Lambda.
- `npm run verify`: Pipeline local completo que ejecuta lint, tipos, pruebas unitarias y build sin errores.

## Criterios de Aceptación
- Un clon limpio del repositorio instala dependencias con `npm ci` y ejecuta `npm run verify` exitosamente en verde sin requerir configuración manual previa.
- Los Git hooks impiden commits que incumplan las normas de linter o mensajes sin formato Conventional Commit.
