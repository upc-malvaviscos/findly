# 9. Conclusiones y trabajo futuro

## Objetivos alcanzados

El recorrido completo de negocio — inscripción pública con consentimiento
biométrico, indexación facial, matching asíncrono, galería privada temporal y
derecho al olvido — está implementado, probado unitariamente y **verificado
contra servicios AWS reales**, no sólo simulados, en el run de aceptación de
[PR #71](https://github.com/upc-malvaviscos/findly/pull/71) (capítulo 8). La
arquitectura serverless (ADR-002) se sostiene sin RDS, EC2, NAT ni VPC dedicada;
el entorno efímero de pull request (ADR-008) y los tres modos de ejecución local
(mock, Floci, sandbox AWS) permiten desarrollar e integrar sin capacidad de
cómputo dedicada. El almacenamiento y la observabilidad pueden generar consumo
sin tráfico. La observabilidad estructurada (`correlationId`, sin campos
sensibles, retención de 14 días) y el aislamiento de datos sensibles por entorno
y evento (ADR-013, ADR-014, ADR-015) están verificados con la misma evidencia
desplegada.

Desde esa primera aceptación, se cerraron además en AWS real: el disparo real
del `EventBridge Scheduler` y su recuperación ante fallo parcial (#10), el
backend de estado remoto (#11/#61), la demo persistente — probada y desactivada
por coste, no por fallo (#15) —, el backend web real (#22), la
observabilidad/FinOps con la alarma DLQ real como evidencia suficiente del canal
de aviso (#13), la inscripción facial (#7), y la actualización, descarga
autorizada y enlace compartido de galería (#88), incluida la descarga real con
navegador contra S3 real en Chromium/Firefox. El recorrido ampliado acordado el
2026-10-03 también está cerrado: matching convergente en cualquier orden de
subida con backfill post-`ENROLLED` (#87), la decisión de motor DynamoDB con su
benchmark de fan-out real (#49), la edición y borrado administrativo de eventos
y fotografías (#89), el correo obligatorio y envío manual de galerías con Amazon
SES (#86), la invitación administrativa por Cognito confirmada con recepción y
primer acceso reales (#105), la auditoría de cierres que exigió esta misma
disciplina de evidencia (#70) y el reintento/deduplicación en la subida de
fotografías (#121). Además, la SPA y la API de **producción**
(`www.findly.barcelona`) están desplegadas y son públicas desde el 2026-10-05,
con identidad SES, DKIM y MAIL FROM verificados y certificado ACM emitido. El
acceso de producción SES se confirmó concedido el 2026-10-15 y el despliegue
OIDC 38781070488 habilitó el correo, conservando Cognito con SES. La aceptación
de recuperación, feedback y recepción en producción se completó con éxito
mediante los runs 38950320818 y 38955016584, demostrando la resiliencia en AWS y
la entrega autenticada con SPF, DKIM y DMARC (#98: evidencia de un buzón;
reabierta por multiproveedor pendiente).

## Limitaciones verificadas

Se distinguen resultados históricos, límites de evidencia y riesgos
identificados en el código de referencia `7fc0376` (23-oct-2026). Un riesgo
comprobado por lectura no se presenta como una carrera reproducida en AWS.

- **Invitaciones administrativas por Cognito verificadas.** La entrega de correo
  de galerías en producción quedó verificada con entrega real en bandeja de
  entrada (`inbox`) y autenticación criptográfica estricta (SPF, DKIM y DMARC
  pass en la issue #98). Por separado, la invitación de administradores por
  Cognito conserva desde la decisión del 2026-10-15 su configuración SES con el
  dominio propio, declarada en Terraform independientemente del correo de
  galerías; el 2026-10-20 se confirmó la recepción de la clave temporal y el
  primer acceso administrativo satisfactorio en producción, cerrando la issue
  #105.
- **Entregabilidad del correo de galerías verificada con un único buzón, no con
  dos proveedores independientes.** El cierre de #86 (2026-10-17) dejó
  explícitamente pendiente en #98 confirmar la recepción con dos proveedores de
  correo independientes (Google Workspace / Microsoft 365). La evidencia que
  cerró #98 (2026-10-19) acredita entrega real, bandeja de entrada y
  autenticación SPF/DKIM/DMARC estricta en un único buzón autorizado
  (`info@findly.barcelona`) — no se documenta una segunda prueba con un
  proveedor de correo distinto. No se presenta aquí como si ese segundo
  proveedor se hubiera verificado: #98 se reabre el 23-oct-2026 para completar
  el criterio original, sin relajar su alcance.
- **Migración de colecciones Rekognition heredadas pendiente.** ADR-015 aísla
  colecciones por entorno; las colecciones creadas antes de esa decisión
  (`findly-event-*`, sin sufijo de entorno) no se migran ni se borran
  automáticamente, y esa migración no se ha planificado con fecha.
- **DynamoDB confirmado y fallos de #49 corregidos, con límite concurrente
  actual.** ADR-022 confirma el motor y el acceso inverso mediante ítem espejo.
  Los dos hallazgos de la PR #141 se corrigieron en #143/#144: timeout de 60 s,
  `BatchWriteCommand` en lotes de 25 y reintento de `UnprocessedItems`;
  `writeMatch` añade un `ConditionCheck` sobre la foto. La aceptación AWS
  combinada registró `204` en 2.020 ms con 100 matches y 3.082 ms con 1.000, sin
  huérfanos, y pasó la carrera subida/borrado ejercitada. No es una garantía
  general de concurrencia: #166 incorpora la barrera `deletedAt` antes de la
  consulta y revalida ausencia de marca y TTL vigente en la transacción,
  verificados localmente con unitarias y Floci. #168 está integrada y supera el
  smoke AWS efímero con teardown. Quedan pendientes los ensayos específicos de
  carreras/TTL en AWS, la publicación permanente y los ensayos de borrado de
  evento con backfill/correo en curso. El detalle histórico está en
  [la evidencia de #89](../evidence/issue-89-admin-event-photo-lifecycle.md), y
  el estado posterior al merge en
  [la evidencia de #166](../evidence/issue-166-photo-matching-barrier.md).
- **WebKit no completa la descarga real contra S3, Chromium y Firefox sí.**
  Verificado contra el entorno efímero real (issue #88, PR #130): Chromium y
  Firefox descargan el adjunto con nombre y contenido correctos navegando
  directamente a la URL firmada; WebKit agota el tiempo de espera del evento de
  descarga. Esto confirma, con un resultado medido en CI y no sólo con una
  comprobación aislada, que la limitación ya conocida de Playwright con WebKit
  no depende únicamente de interceptar rutas.
- **Cobertura de líneas global por debajo del 90 % en la medición histórica
  citada.** El gate obligatorio de cobertura se aplica sólo a `src/lambdas`
  y `src/shared/lib` (93,78 % y 100 % respectivamente en esa medición); la
  cobertura global fue del 81,34 % y no se presenta como si cumpliera un
  umbral que nunca se declaró para ella.
- **Una limitación del arnés de pruebas, no de la aplicación.** Cuatro pruebas
  de `tests/infra/deployedObservability.test.ts` fallan de forma reproducible en
  Windows por una incompatibilidad de su fixture de CLI con la resolución de
  ejecutables de ese sistema operativo (capítulo 8); la CI real, en Ubuntu, no
  se ve afectada.

## Lecciones de la metodología

La lección metodológica más concreta de este proyecto (capítulo 2) es
cuantificable: de las 19 issues que el equipo daba por cerradas antes de la fase
3, una auditoría independiente y explícita (`#70`) encontró que 5 no tenían
evidencia desplegada real pese a checks de CI en verde, y forzó su reapertura.
Dos de ellas (`#6`, `#8`) se recerraron el mismo día con una prueba en AWS real;
las otras tres (`#10`, `#13`, `#18`) más `#22`, reabierta por el mismo motivo,
siguieron abiertas durante semanas porque la auditoría fue igual de estricta
consigo misma: no las cerró sólo por haber corregido el resto. De esas cuatro,
`#10`, `#13` y `#22` se cerraron con nueva evidencia desplegada (capítulo 8);
`#18` —esta misma memoria— permaneció abierta semanas más, por una condición
distinta y explícita: no cerrarla hasta reflejar el recorrido ampliado de
\#49/#86/#87/#89 realmente implementado y verificado, no por evidencia de demo
pendiente (ese punto se había resuelto antes). Esas cuatro issues cerraron entre
el 2026-10-16 y el 2026-10-19, documentando los hallazgos encontrados y su
evolución posterior: los de #49 se corrigieron y verificaron mediante #143/#144,
mientras la inconsistencia `404`/`410` de #89 sigue documentada sin unificación
— la misma disciplina que fuerza esta memoria. La issue #18 quedó cerrada con la
entrega académica: el coste de esa disciplina es visible — issues que "ya
estaban hechas" volvieron a ocupar trabajo activo durante semanas —, pero sin
ella este documento estaría citando código probado únicamente con mocks como si
fuera una demostración en AWS, el error exacto que `AGENTS.md` prohíbe desde el
primer día del proyecto (capítulo 2). La conclusión práctica para un equipo que
reutilice este enfoque: una auditoría de cierre programada, no sólo checks de
CI, es la que realmente hace cumplir la regla de "sin evidencia no hay cierre"
sobre trabajo que ya se consideraba terminado — y que cerrar con un hallazgo
documentado y sin corregir es preferible a dejarlo oculto bajo un check en
verde.

## Trabajo futuro

1. Completar la aceptación de correo de #98 con dos proveedores independientes y
   recibos/cabeceras verificables. El único buzón corporativo acreditado no
   satisface por sí solo ese criterio.
2. Completar los ensayos AWS específicos de carreras/TTL y la publicación
   permanente de #166, integrada por #168 con smoke AWS efímero y teardown:
   la implementación ya incorpora barrera previa, ausencia de `deletedAt`,
   TTL lógico vigente y espejos conservados hasta borrar matches por página.
   Añadir pruebas dedicadas de borrado de evento con backfill/correo en curso. Los lotes y el timeout de 60 s ya están
   implementados y desplegados.
3. Unificar el código de respuesta (`404` frente a `410`) entre
   `publicEnrollment.ts` y `createPhotoUploads` ante un evento cerrado o con
   retención vencida (hallazgo de la PR #148 de la issue #89), y decidir cuál de
   los dos es el contrato correcto antes de cambiar ninguno.
4. Decidir y documentar en un ADR la migración de colecciones Rekognition
   heredadas a nombres aislados por entorno (ADR-015).
5. Implementar el patrón _Transactional Outbox_ (mediante DynamoDB Streams y
   EventBridge Pipes) para desacoplar transaccionalmente la persistencia en
   DynamoDB de la publicación de mensajes en SQS en la indexación de selfies
   (disparo de backfill) y en la orden de envío de correos. Streams y Pipes son
   una propuesta pendiente de ADR y evaluación de coste y recuperación;
   la entrega al menos una vez sigue requiriendo consumidores idempotentes.
6. Fuera del alcance de este MVP académico, y no planificado: revisión legal
   formal de protección de datos, campañas de marketing por correo o SMS a los
   asistentes, escalado más allá de un evento concurrente y operación en
   producción con soporte 24/7.
