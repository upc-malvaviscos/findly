# 14 - Despliegue manual OIDC

## Objetivo
Permitir a un miembro autorizado desplegar sin claves AWS persistentes.

## Requisitos
- Workflow `workflow_dispatch`, input de entorno, plan visible y environment GitHub protegido antes de apply.
- Restringir trust OIDC a `upc-malvaviscos/findly` y ramas aprobadas.
- Subir `out/` al bucket web e invalidar CloudFront tras apply.

## Aceptación
La ejecución conserva SHA, plan, outputs no sensibles y evidencia de aprobación.
