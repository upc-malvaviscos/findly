# Inscripción pública: evidencia de implementación

- Alcance: issues #7 y #22; coordinación #70.
- Contrato aprobado: ADR-011.
- Handlers: publicEvents, publicEnrollment y selfieIndexer.
- IaC: módulos public-enrollment y selfie-indexer; el ensamblado de raíces y
  la notificación S3 única se realizan en la entrega de integración.

## Reproducción local

```sh
npm ci
npm run typecheck
npm exec -- vitest run tests/lambdas/publicEvents.test.ts tests/lambdas/publicEnrollment.test.ts tests/lambdas/selfieIndexer.test.ts tests/web/realApi.test.ts
npm run build
```

Los tests usan aws-sdk-client-mock; no acreditan una ejecución AWS.
La indexación facial real, el navegador sin interceptación y la destrucción de
recursos requieren la prueba AWS efímera antes de cerrar las issues.

## Resultados locales del 2026-09-28

- Typecheck, ESLint, markdownlint y sync:check: correctos.
- Suite unitaria: se comprueban inscripción, capacidad, lease, borrado
  concurrente, selección de eventos y contadores de error sin PII.
- Build: nueve bundles y ZIP Lambda cargables.
- Chromium: cuatro pruebas E2E con backend interceptado correctas.
- Terraform: ambos módulos validan con AWS provider 6.66.0 aprobado.
  El provider 5.100.0 anterior rechazaba nodejs24.x; no se rebajó el runtime.
  No se ha aplicado AWS.
- Smoke real disponible en scripts/public-enrollment-smoke.mjs: canvas JPEG
  sintético sin cara, consentimiento, capacidad, subida y terminal FAILED.
  No se ha ejecutado contra AWS en esta entrega.
