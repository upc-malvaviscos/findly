# 12 - Observabilidad, alertas y controles de FinOps

## Objetivo
Implementar trazabilidad integral, monitoreo estructurado y alertas de presupuestos para detectar errores, controlar costes y garantizar la privacidad de los datos personales.

## Requisitos de Observabilidad y Logs
- **Formato JSON Estructurado**: Todas las funciones Lambda emiten logs en JSON con contexto: `correlationId`, `eventId`, `timestamp`, `level`, `action`, `durationMs`.
- **Privacidad Estricta (No PII)**: Prohibición absoluta de registrar nombres, correos electrónicos, imágenes o vectores biométricos en CloudWatch Logs.
- **Retención de Logs**: Configurada exactamente a 14 días para minimizar costes de almacenamiento en CloudWatch.

## Alertas y Presupuestos (AWS Budgets & CloudWatch Alarms)
- **Alarmas de Error**: Alarma CloudWatch por tasa de fallos en Lambda superior al 2% o errores 5xx en API Gateway.
- **FinOps Controls (AWS Budgets)**:
  - Alerta al alcanzar el 80% del presupuesto mensual previsto ($0.00 en capa gratuita / $5.00 en sandbox).
  - Alerta crítica al alcanzar el 100% del presupuesto real con notificación por email a los responsables de la plataforma.

## Criterios de Aceptación
- La matriz de costes por entorno queda documentada en la memoria técnica (`docs/paper/07-finops-observabilidad-y-sostenibilidad.md`).
- Un fallo provocado en Lambda permite rastrear el `correlationId` en CloudWatch sin exponer información personal identificable (PII).
