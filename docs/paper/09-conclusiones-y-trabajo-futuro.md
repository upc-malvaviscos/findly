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

Desde esa primera aceptación, se cerraron además en AWS real: el disparo
real del `EventBridge Scheduler` y su recuperación ante fallo parcial (#10),
el backend de estado remoto (#11/#61), la demo persistente — probada y
desactivada por coste, no por fallo (#15) —, el backend web real (#22), la
observabilidad/FinOps con la alarma DLQ real como evidencia suficiente del
canal de aviso (#13), la inscripción facial (#7), y la actualización,
descarga autorizada y enlace compartido de galería (#88), incluida la
descarga real con navegador contra S3 real en Chromium/Firefox. Además, la
SPA y la API de **producción** (`www.findly.barcelona`) están desplegadas y
son públicas desde el 2026-10-05, con identidad SES, DKIM y MAIL FROM
verificados y certificado ACM emitido — con el envío de correo
deshabilitado en la última publicación comprobada. El acceso de producción
SES está concedido desde la comprobación del 2026-10-15; despliegue y pruebas
de recepción siguen pendientes (#98, abierta).

## Limitaciones verificadas

Estas limitaciones no son suposiciones: cada una está registrada como
pendiente en la propia evidencia que demuestra el resto del sistema
(capítulo 8), no inferida por esta memoria.

- **Correo de galería y de invitación administrativa sin confirmar en
  buzón real.** La SPA/API de producción están públicas, pero el envío de
  correo de galería todavía requiere despliegue y aceptación AWS. SES ya
  permite destinatarios fuera del sandbox; esto no acredita recepción ni
  apertura en un buzón (issue #98). Por separado, la invitación de administradores por
  Cognito usa el remitente genérico de Cognito, no el dominio propio — una
  decisión de Terraform independiente del correo de galerías; no hay forma de confirmar desde el
  código si el correo llega a la bandeja o a spam de un destinatario real
  (issue #105).
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
- **Administración de eventos/fotos bloqueada por un recurso externo, no
  por el código.** La PR #120 (issue #89: editar/borrar eventos, eliminar
  fotografías) tiene todos sus checks de código en verde, pero su entorno
  efímero de AWS real falla por un bloqueo de estado de Terraform obsoleto
  (`terraform force-unlock`) que exige credenciales que el equipo no tenía
  disponibles en el momento de escribir esto.
- **WebKit no completa la descarga real contra S3, Chromium y Firefox sí.**
  Verificado contra el entorno efímero real (issue #88, PR #130): Chromium
  y Firefox descargan el adjunto con nombre y contenido correctos
  navegando directamente a la URL firmada; WebKit agota el tiempo de
  espera del evento de descarga. Esto confirma, con un resultado medido en
  CI y no sólo con una comprobación aislada, que la limitación ya conocida
  de Playwright con WebKit no depende únicamente de interceptar rutas.
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
por el mismo motivo, siguieron abiertas durante semanas porque la auditoría
fue igual de estricta consigo misma: no las cerró sólo por haber corregido el
resto. De esas cuatro, `#10`, `#13` y `#22` ya se cerraron con nueva
evidencia desplegada (capítulo 8); `#18` —esta misma memoria— sigue abierta,
ahora por una condición distinta y explícita: no cerrarla hasta reflejar el
recorrido ampliado de #49/#86/#87/#89 realmente implementado y verificado,
no por evidencia de demo pendiente (ese punto ya se resolvió). El coste de
esa disciplina es visible — issues que "ya estaban hechas" volvieron a ocupar
trabajo activo —, pero sin ella este documento estaría citando código
probado únicamente con mocks como si fuera una demostración en AWS, el error
exacto que `AGENTS.md` prohíbe desde el primer día del proyecto (capítulo 2).
La conclusión práctica para un equipo que reutilice este enfoque: una
auditoría de cierre programada, no sólo checks de CI, es la que realmente
hace cumplir la regla de "sin evidencia no hay cierre" sobre trabajo que ya
se consideraba terminado.

## Trabajo futuro

1. Completar el despliegue y la aceptación real del correo de galerías tras
   la aprobación regional SES ya comprobada. Verificar recuperación, feedback
   y recepción/apertura en al menos dos proveedores distintos; una prueba
   parcial autorizada con un solo buzón deja ese criterio pendiente
   (issue #98, seguimiento de #86).
2. Resolver el bloqueo de estado de Terraform de la PR #120 (requiere
   `terraform force-unlock` con credenciales AWS) para poder completar y
   fusionar la administración de edición/borrado de eventos y fotos
   (issue #89).
3. Decidir y documentar en un ADR la migración de colecciones Rekognition
   heredadas a nombres aislados por entorno (ADR-015).
4. Resolver formalmente la decisión DynamoDB frente a RDS (issue #49): si se
   confirma un requisito de informes o consultas transversales, revisar la
   recomendación con ese requisito explícito; coordinar con la convergencia
   de matching (#87) y el borrado concurrente (#89).
5. Cerrar #18 una vez #49/#86/#87/#89 estén resueltas y su alcance ampliado
   quede reflejado en esta memoria y en el runbook de demostración.
6. Fuera del alcance de este MVP académico, y no planificado: revisión legal
   formal de protección de datos, notificación transaccional por correo o
   SMS a los asistentes, escalado más allá de un evento concurrente y
   operación en producción con soporte 24/7.
