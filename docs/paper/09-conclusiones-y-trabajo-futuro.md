# 9. Conclusiones y trabajo futuro

## Objetivos alcanzados

El recorrido completo de negocio — inscripción pública con consentimiento
biométrico, indexación facial, matching asíncrono, galería privada temporal y
derecho al olvido — está implementado, probado unitariamente y **verificado
contra servicios AWS reales**, además de las pruebas simuladas, en el run de aceptación de
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
cerrada por confirmación manual multiproveedor posterior).

## Limitaciones verificadas

Se distinguen resultados históricos, límites de evidencia y riesgos
identificados en el código de referencia `7fc0376` (23-oct-2026). La lectura
de código identifica riesgos; la reproducción en AWS de las carreras señaladas
queda pendiente.

- **Invitaciones administrativas por Cognito verificadas.** La entrega de correo
  de galerías en producción quedó verificada con entrega real en bandeja de
  entrada (`inbox`) y autenticación criptográfica estricta (SPF, DKIM y DMARC
  pass en la issue #98). Por separado, la invitación de administradores por
  Cognito conserva desde la decisión del 2026-10-15 su configuración SES con el
  dominio propio, declarada en Terraform independientemente del correo de
  galerías; el 2026-10-20 se confirmó la recepción de la clave temporal y el
  primer acceso administrativo satisfactorio en producción, cerrando la issue
  #105.
- **Entregabilidad con procedencias diferenciadas.** El recibo automatizado
  acredita un buzón y autenticación SPF/DKIM/DMARC. El equipo confirmó el
  criterio de dos proveedores el 23-oct-2026 y cerró #98. Se conserva como
  confirmación manual, sin inventar un segundo run; véase la
  [evidencia actualizada](../evidence/issue-98-ses-production.md).
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
  huérfanos, y pasó la carrera subida/borrado ejercitada. La evidencia cubre esos
  escenarios; la concurrencia general queda pendiente. #166 incorpora la barrera
  `deletedAt` antes de la
  consulta y revalida ausencia de marca y TTL vigente en la transacción,
  verificados localmente con unitarias y Floci. #168 está integrada y supera el
  smoke AWS efímero con teardown. Por decisión del equipo del 23-oct-2026,
  la aceptación AWS específica de carreras y TTL lógico se aplaza a una próxima
  etapa; #166 permanece abierta con ese criterio sin verificar. La publicación
  permanente es una actuación operativa independiente. Los ensayos de borrado de
  evento con backfill/correo en curso quedan fuera del alcance de #166. El detalle histórico está en
  [la evidencia de #89](../evidence/issue-89-admin-event-photo-lifecycle.md), y
  el estado posterior al merge en
  [la evidencia de #166](../evidence/issue-166-photo-matching-barrier.md).
- **Descarga real contra S3: timeout en WebKit y éxito en Chromium y Firefox.**
  Verificado contra el entorno efímero real (issue #88, PR #130): Chromium y
  Firefox descargan el adjunto con nombre y contenido correctos navegando
  directamente a la URL firmada; WebKit agota el tiempo de espera del evento de
  descarga. El resultado medido en CI confirma que la limitación ya conocida de
  Playwright con WebKit también aparece con S3 real, más allá de la interceptación
  de rutas.
- **Cobertura de líneas global por debajo del 90 % en la medición histórica
  citada.** El gate obligatorio de cobertura se aplica sólo a `src/lambdas`
  y `src/shared/lib` (93,78 % y 100 % respectivamente en esa medición); la
  cobertura global informativa fue del 81,34 %.
- **Una limitación específica del arnés de pruebas en Windows.** Cuatro pruebas
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
reutilice este enfoque: una auditoría de cierre programada complementa los checks
de CI y hace cumplir la regla de "sin evidencia no hay cierre" sobre trabajo que ya se consideraba terminado — y que cerrar con un hallazgo
documentado y sin corregir es preferible a dejarlo oculto bajo un check en
verde.

## Trabajo futuro

1. Ampliar la evidencia automatizada de correo tras la confirmación manual de #98 y
   recibos/cabeceras verificables. El único buzón corporativo acreditado no
   satisface por sí solo ese criterio.
2. Retomar en una próxima etapa la aceptación AWS específica de #166. La
   implementación está integrada por #168, con pruebas locales y smoke AWS
   efímero con teardown; no se propone rehacer la barrera. La ampliación de
   validación requerirá un arnés con pausas controladas antes del commit y
   durante la limpieza, ambos disparadores de matching, TTL vencido con la fila aún
   presente y recuperación tras fallos parciales. Se comprobará la ausencia de
   matches y espejos residuales, la operación estable y la limpieza de recursos,
   con datos sintéticos, evidencia reproducible y autorización operativa previa.
   Este trabajo queda aplazado, sin fecha comprometida ni aceptación completa;
   #166 conserva su criterio AWS pendiente. La publicación permanente se
   decidirá por separado. Los ensayos de borrado completo de evento con
   backfill/correo en curso son otra línea de mejora, fuera de #166; los lotes y
   el timeout de 60 s ya están implementados y desplegados.
3. Unificar el código de respuesta (`404` frente a `410`) entre
   `publicEnrollment.ts` y `createPhotoUploads` ante un evento cerrado o con
   retención vencida (hallazgo de la PR #148 de la issue #89), y decidir cuál de
   los dos es el contrato correcto antes de cambiar ninguno.
4. Decidir y documentar en un ADR la migración de colecciones Rekognition
   heredadas a nombres aislados por entorno (ADR-015).
5. Implementar el patrón _Transactional Outbox_ para resolver la escritura
   doble que hoy existe entre DynamoDB y SQS en la indexación de selfies
   (disparo de _backfill_) y en la orden de envío de correos: ambos flujos
   confirman el cambio de estado en DynamoDB y encolan el mensaje en una
   llamada aparte, sin transacción conjunta, de forma que un fallo posterior
   a la escritura deja el estado y la publicación desalineados. La propuesta
   consiste en dejar de llamar a SQS desde la propia función y aprovechar
   Amazon DynamoDB Streams como registro nativo de los cambios de la tabla,
   con Amazon EventBridge Pipes filtrando las transiciones relevantes y
   publicándolas en la cola correspondiente, con reintentos y DLQ gestionados
   por el propio servicio. Streams y Pipes ofrecen entrega al menos una vez,
   por lo que los consumidores de backfill y correo seguirían necesitando las
   mismas condiciones de idempotencia que ya aplican hoy. La adopción de
   Streams/Pipes es una propuesta pendiente de ADR y de evaluación de coste y
   recuperación.
6. Fuera del alcance de este MVP académico, y no planificado: revisión legal
   formal de protección de datos, campañas de marketing por correo o SMS a los
   asistentes, escalado más allá de un evento concurrente y operación en
   producción con soporte 24/7.
