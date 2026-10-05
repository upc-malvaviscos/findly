# 9. Conclusiones y trabajo futuro

## Objetivos alcanzados

El recorrido completo de negocio — inscripción pública con consentimiento
biométrico, indexación facial, matching asíncrono, galería privada temporal y
derecho al olvido — está implementado, probado unitariamente y **verificado
contra servicios AWS reales**, no sólo simulados, en el run de aceptación de
[PR #71](https://github.com/upc-malvaviscos/findly/pull/71) (capítulo 8). La
arquitectura serverless (ADR-002) se sostiene sin RDS, EC2, NAT ni VPC
dedicada; el entorno efímero de pull request (ADR-008) y los tres modos de
ejecución local (mock, Floci, sandbox AWS) permiten desarrollar e integrar sin
coste fijo. La observabilidad estructurada (`correlationId`, sin campos
sensibles, retención de 14 días) y el aislamiento de datos sensibles por
entorno y evento (ADR-013, ADR-014, ADR-015) están verificados con la misma
evidencia desplegada.

## Limitaciones verificadas

Estas limitaciones no son suposiciones: cada una está registrada como
pendiente en la propia evidencia que demuestra el resto del sistema
(capítulo 8), no inferida por esta memoria.

- **Retención por cron real no demostrada.** El run de aceptación invocó
  `RetentionPurger` manualmente; el `EventBridge Scheduler` real no se ha
  ejecutado ni verificado en AWS (issue #10).
- **Presupuesto y correo de alerta sin confirmar.** El módulo `monitoring`
  está validado sólo con un `terraform plan` sin conexión a AWS; el aviso real
  de AWS Budgets y la confirmación de una suscripción de correo no se han
  probado, y el proyecto prohíbe forzar gasto para provocarlo (issue #13).
- **Despliegue persistente sin verificar.** El workflow de despliegue manual
  vía OIDC (spec 14) está implementado y validado estáticamente, pero no se ha
  ejecutado contra un entorno persistente (issue #15). El bootstrap del
  backend de estado (ADR-009) y la migración de sandbox con `moved` sí se
  verificaron en una cuenta AWS dedicada en `eu-west-1` (issue #61), pero esa
  prueba se destruyó al terminar y no dejó un entorno desplegado.
- **Sin SPA de demostración publicada.** Sin el backend de estado (punto
  anterior), no existe un entorno `demo` desplegado de forma persistente que
  una persona externa pueda navegar sin credenciales de desarrollo (issue #18,
  ver también el [runbook de demostración](../runbooks/demo-runbook.md)).
- **Migración de colecciones Rekognition heredadas pendiente.** ADR-015 aísla
  colecciones por entorno; las colecciones creadas antes de esa decisión
  (`findly-event-*`, sin sufijo de entorno) no se migran ni se borran
  automáticamente, y esa migración no se ha planificado con fecha.
- **Decisión DynamoDB frente a RDS abierta.** La revisión del 2026-10-05 del
  [análisis de #49](../evidence/issue-49-dynamodb-vs-rds-analysis.md) inventaría
  las 12 issues abiertas de su instantánea y sustituye los gaps históricos
  ya resueltos. #87/#89 introducen incertidumbre material de convergencia,
  acceso inverso foto→matches y borrado concurrente. Mantener la implementación
  vigente mientras se decide no equivale a aprobar DynamoDB para todo el
  backlog. Comparación medida, aprobación y ADR final siguen pendientes.
- **Cobertura de líneas global por debajo del 90 %.** El gate obligatorio de
  cobertura se aplica sólo a `src/lambdas` y `src/shared/lib` (93,78 % y
  100 % respectivamente); la cobertura global del proyecto es del 81,34 % y no
  se presenta como si cumpliera un umbral que nunca se declaró para ella.
- **Una limitación del arnés de pruebas, no de la aplicación.** Cuatro pruebas
  de `tests/infra/deployedObservability.test.ts` fallan de forma reproducible
  en Windows por una incompatibilidad de su fixture de CLI con la resolución
  de ejecutables de ese sistema operativo (capítulo 8); la CI real, en Ubuntu,
  no se ve afectada.

## Lecciones de la metodología

La lección metodológica más concreta de este proyecto (capítulo 2) es
cuantificable: de las 19 issues que el equipo daba por cerradas antes de la
fase 3, una auditoría independiente y explícita (`#70`) encontró que 5 no
tenían evidencia desplegada real pese a checks de CI en verde, y forzó su
reapertura. Dos de ellas (`#6`, `#8`) se recerraron el mismo día con una
prueba en AWS real; las otras tres (`#10`, `#13`, `#18`) más `#22`, reabierta
por el mismo motivo, siguen abiertas porque la auditoría fue igual de
estricta consigo misma: no las cerró sólo por haber corregido el resto. El coste de esa
disciplina es visible — issues que "ya estaban hechas" volvieron a ocupar
trabajo activo —, pero sin ella este documento estaría citando código
probado únicamente con mocks como si fuera una demostración en AWS, el error
exacto que `AGENTS.md` prohíbe desde el primer día del proyecto (capítulo 2).
La conclusión práctica para un equipo que reutilice este enfoque: una
auditoría de cierre programada, no sólo checks de CI, es la que realmente
hace cumplir la regla de "sin evidencia no hay cierre" sobre trabajo que ya
se consideraba terminado.

## Trabajo futuro

1. Verificar en AWS real el disparo del `EventBridge Scheduler`, la alerta de
   AWS Budgets y la entrega de un correo de suscripción confirmado (issues
   #10, #13).
2. Ejecutar el despliegue manual vía OIDC contra `sandbox` o `demo` sobre un
   backend de estado aplicado con `infra/bootstrap` (issue #15; el bootstrap
   ya se verificó en #61).
3. Publicar una SPA de demostración persistente y ejecutar el
   [runbook de demostración](../runbooks/demo-runbook.md) de extremo a
   extremo contra ella, incluida su limpieza (issue #18).
4. Decidir y documentar en un ADR la migración de colecciones Rekognition
   heredadas a nombres aislados por entorno (ADR-015).
5. Resolver formalmente la decisión DynamoDB frente a RDS (issue #49): si se
   confirma un requisito de informes o consultas transversales, revisar la
   recomendación con ese requisito explícito.
6. Fuera del alcance de este MVP académico, y no planificado: revisión legal
   formal de protección de datos, notificación transaccional por correo o
   SMS a los asistentes, escalado más allá de un evento concurrente y
   operación en producción con soporte 24/7.
