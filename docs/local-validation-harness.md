# Contrato de entorno y verificación local

Este documento es lectura obligatoria para agentes y contribuidores antes de
implementar o declarar una tarea completada.

## Objetivos de verificación de la issue

La issue asociada es el contrato del trabajo: sus criterios de aceptación y su
checklist son objetivos explícitos de verificación desde el inicio. Durante la
implementación, registra para cada criterio la prueba, salida, documento o PR
que lo demuestra. Antes de afirmar que una tarea está completa, actualiza la
issue: marca sólo los criterios demostrados y deja sin marcar los no probados o
incompletos, explicando brevemente la evidencia que falta. Una tarea no está
completa si algún criterio sigue sin prueba, incompleto o sin sincronizar.

Si una issue no cabe en una unidad coherente de implementación y verificación,
pueden crearse subissues GitHub relacionadas o dependientes con alcance,
criterios y vínculo explícitos a la issue padre. No se crean como lista privada
ni de forma especulativa. Al finalizar, relee la descripción y checklist de la
issue padre y de cada subissue vinculada; sincroniza desde evidencia sus estados,
casillas y dependencias en GitHub antes de declarar el trabajo completo.

## Bootstrap y diagnóstico

```sh
nvm install 24 && nvm use 24
npm ci
npm run harness:check
```

El último comando falla de forma cerrada: enumera cada herramienta ausente y su
comando de instalación. No se permite omitir un validador ausente ni declarar
éxito parcial como finalización.

El contrato base exige Node 24.x, npm 11+, las dependencias bloqueadas por
`package-lock.json`, Terraform y TFLint. Los binarios de ESLint, Prettier,
Markdownlint, actionlint, TypeScript, Vitest, Vite, esbuild y Playwright deben
provenir de `npm ci`; no se sustituyen por instalaciones globales.

Para una tarea que ejecute E2E, añade Docker Compose y navegadores Playwright:

```sh
npm run harness:check:e2e
npm exec -- playwright install --with-deps
```

`test:e2e:local` levanta Floci mediante `docker compose`; por tanto, no debe
ejecutarse ni declararse validado si Docker no está disponible.

## Hooks

- `commit-msg` conserva Conventional Commits mediante commitlint.
- `pre-commit` realiza sólo comprobaciones rápidas del contenido staged:
  espacios de diff y Prettier.
- `pre-push` ejecuta `npm run harness:check` y después `npm run verify`.

Un fallo de hook es una señal de corrección o instalación pendiente. No se usa
`--no-verify` para eludirlo. Si el repositorio base tiene una infracción ajena,
repórtala con el archivo y el comando que falló; no la ocultes ni declares el
trabajo validado.
