# 12 - Observabilidad y FinOps

## Objetivo
Hacer visibles coste, fallos y caducidad.

## Requisitos
- Logs JSON con alcance, evento, correlación y error; nunca nombres/correos/fotos en logs.
- Alarmas para errores Lambda, presupuesto 80% previsto y 100% real; retención de logs 14 días.
- Añadir matriz de coste de escenario en la memoria y etiquetas obligatorias.

## Aceptación
El runbook identifica coste por entorno y permite localizar un fallo por correlación sin exponer PII.
