# 16 - Validación integral, pruebas unitarias, contratos y E2E

## Objetivo
Establecer la estrategia completa de verificación técnica y calidad del sistema, cubriendo desde pruebas unitarias aisladas hasta pruebas de integración de Lambdas con mocks de AWS y flujos End-to-End en navegadores reales con Playwright.

## Niveles de Validación y Cobertura

### 1. Pruebas Unitarias y de Contratos (Vitest)
- Validación de serialización Zod y DTOs en cliente y backend.
- Pruebas unitarias de componentes React en Frontend utilizando `@testing-library/react`.
- Cobertura de código mínima exigida: **90%** en componentes de lógica de negocio e integraciones.

### 2. Pruebas de Integración de Lambdas
- Ejecución de Lambdas localmente simulando clientes AWS con `aws-sdk-client-mock`.
- Verificación de la manipulación de eventos S3 (`ObjectCreated:Put`), indexación en Rekognition y escrituras DynamoDB Single-Table.

### 3. Pruebas End-to-End (Playwright E2E)
- Suite completa en Playwright ejecutada contra la compilación estática `out/`.
- Flujos probados:
  - Registro de asistente con captura de selfie (con mocks de respuesta de presigned URL y polling).
  - Carga masiva de fotos en el panel de administración.
  - Visualización de la galería privada `/gallery?token=valid-token`.
  - Ejercicio del derecho al olvido (solicitud de borrado).

## Criterios de Aceptación
- La matriz de pruebas documentada en `docs/paper/08-validacion-y-resultados.md` está completa con evidencias de ejecución en verde.
- Todos los comandos de prueba (`npm run test`, `npm run test:e2e`) finalizan con código de salida 0 en el CI.
