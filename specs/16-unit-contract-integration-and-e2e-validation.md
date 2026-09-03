# 16 - Validación integral, pruebas unitarias, contratos y E2E

## Objetivo
Establecer la estrategia completa de verificación técnica y calidad del sistema en React + Vite, cubriendo desde pruebas unitarias aisladas hasta pruebas de integración de Lambdas con mocks del AWS SDK v3 y flujos End-to-End en navegadores reales con Playwright.

## Alineación con AWS Well-Architected Framework
- **Excelencia Operativa**: Verificación técnica automatizada multi-capa (Vitest + React Testing Library + Playwright E2E) con cobertura del 90%.

## Estrategia de Pruebas
1. **Unitario & Componentes**: Vitest + `@testing-library/react`.
2. **Integración Lambda**: `aws-sdk-client-mock` en Node.js 22.
3. **E2E**: Playwright sobre la compilación estática `dist/`.

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Configurar Vitest y Mocks de AWS
- En `vitest.config.ts`, configura los alias de módulo.
- Usa `aws-sdk-client-mock` para simular respuestas de Rekognition, DynamoDB y S3 en los tests de Lambdas.

### Paso 2: Crear la Suite E2E en Playwright
- En `e2e/enrollment.spec.ts`, escribe las pruebas que simulen la navegación y registro.
- Ejecuta `npm run test:e2e`.

## Errores Comunes a Evitar (Pitfalls)
- ❌ **ERROR**: Realizar llamadas reales a las APIs de AWS (Rekognition/DynamoDB) durante las pruebas unitarias.
  - *Solución*: Utiliza siempre `aws-sdk-client-mock` para aislar las pruebas y evitar costes en AWS.

## Lista de Verificación Pre-PR (Junior Checklist)
- [ ] `npm run test` alcanza una cobertura >= 90% en la lógica de negocio.
- [ ] `npm run test:e2e` completa exitosamente sin errores de tiempo de espera.
