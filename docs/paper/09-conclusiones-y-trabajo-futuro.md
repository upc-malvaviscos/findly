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
descarga real con navegador contra S3 real en Chromium/Firefox. El recorrido
ampliado acordado el 2026-10-03 también está cerrado: matching convergente
en cualquier orden de subida con backfill post-`ENROLLED` (#87), la decisión
de motor DynamoDB con su benchmark de fan-out real (#49), la edición y
borrado administrativo de eventos y fotografías (#89), el correo obligatorio
y envío manual de galerías con Amazon SES (#86), la invitación
administrativa por Cognito confirmada con recepción y primer acceso reales
(#105), la auditoría de cierres que exigió esta misma disciplina de
evidencia (#70) y el reintento/deduplicación en la subida de fotografías
(#121). Además, la
SPA y la API de **producción** (`www.findly.barcelona`) están desplegadas y
son públicas desde el 2026-10-05, con identidad SES, DKIM y MAIL FROM
verificados y certificado ACM emitido. El acceso de producción SES se confirmó
concedido el 2026-10-15 y el despliegue OIDC 38781070488 habilitó el correo,
conservando Cognito con SES. La aceptación de recuperación, feedback y recepción
en producción se completó con éxito mediante los runs 38950320818 y 38955016584,
demostrando la resiliencia en AWS y la entrega autenticada con SPF, DKIM y DMARC (#98, cerrada).

## Limitaciones verificadas

Estas limitaciones no son suposiciones: cada una está registrada como
pendiente en la propia evidencia que demuestra el resto del sistema
(capítulo 8), no inferida por esta memoria.

- **Invitaciones administrativas por Cognito verificadas.** La entrega de correo
  de galerías en producción quedó verificada con entrega real en bandeja de entrada
  (`inbox`) y autenticación criptográfica estricta (SPF, DKIM y DMARC pass en la
  issue #98). Por separado, la invitación de administradores por Cognito conserva
  desde la decisión del 2026-10-15 su configuración SES con el dominio propio,
  declarada en Terraform independientemente del correo de galerías; el 2026-10-20
  se confirmó la recepción de la clave temporal y el primer acceso administrativo
  satisfactorio en producción, cerrando la issue #105.
- **Entregabilidad del correo de galerías verificada con un único buzón, no
  con dos proveedores independientes.** El cierre de #86 (2026-10-17) dejó
  explícitamente pendiente en #98 confirmar la recepción con dos proveedores
  de correo independientes (Google Workspace / Microsoft 365). La evidencia
  que cerró #98 (2026-10-19) acredita entrega real, bandeja de entrada y
  autenticación SPF/DKIM/DMARC estricta en un único buzón autorizado
  (`info@findly.barcelona`) — no se documenta una segunda prueba con un
  proveedor de correo distinto. No se presenta aquí como si ese segundo
  proveedor se hubiera verificado.
- **Migración de colecciones Rekognition heredadas pendiente.** ADR-015 aísla
  colecciones por entorno; las colecciones creadas antes de esa decisión
  (`findly-event-*`, sin sufijo de entorno) no se migran ni se borran
  automáticamente, y esa migración no se ha planificado con fecha.
- **Decisión DynamoDB frente a RDS resuelta, con dos hallazgos operativos sin
  corregir.** La revisión del 2026-10-05 del
  [análisis de #49](../evidence/issue-49-dynamodb-vs-rds-analysis.md) inventarió
  las 12 issues abiertas de su instantánea y sustituyó los gaps históricos
  ya resueltos. [ADR-022](../adr/ADR-022-confirm-dynamodb-persistence.md)
  (2026-10-12) confirmó DynamoDB para todo el backlog y fijó los contratos de
  acceso de #87/#89. La PR #141 ejecutó el benchmark de coste y fan-out en AWS
  real, confirmando la viabilidad de DynamoDB y el ítem espejo — pero
  encontrando, no descartando, dos problemas reales que esa misma PR dejó sin
  corregir: con 100 o 1.000 matches sobre una sola foto, borrar esa foto
  produce un `500` real por timeout de Lambda (`delete_photo`, 3 s, borrado
  individual sin `BatchWriteCommand`), con ítems huérfanos confirmados en
  DynamoDB ya a partir de 100 matches; y `writeMatch` nunca comprueba si la
  fotografía contra la que escribe un match sigue existiendo, sólo el estado
  de la inscripción — una ventana de carrera verificada por revisión de
  código, no forzada en vivo. Ninguno es un argumento a favor de un motor
  relacional: el mismo patrón de borrado individual bajo el mismo timeout
  falla igual en una tabla relacional. Ambos quedan como trabajo futuro.
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
resto. De esas cuatro, `#10`, `#13` y `#22` se cerraron con nueva evidencia
desplegada (capítulo 8); `#18` —esta misma memoria— permaneció abierta
semanas más, por una condición distinta y explícita: no cerrarla hasta
reflejar el recorrido ampliado de #49/#86/#87/#89 realmente implementado y
verificado, no por evidencia de demo pendiente (ese punto se había resuelto
antes). Esas cuatro issues cerraron entre el 2026-10-16 y el 2026-10-19, cada
una documentando con nombre propio al menos un hallazgo real sin corregir
(issue #49: timeout de borrado con alto fan-out y carrera de diseño en
`writeMatch`; issue #89: inconsistencia `404`/`410` entre dos endpoints) en
vez de ocultarlo para poder cerrar antes — la misma disciplina que fuerza
esta memoria. Con eso, `#18` se cierra con esta entrega: el coste de esa
disciplina es visible — issues que "ya estaban hechas" volvieron a ocupar
trabajo activo durante semanas —, pero sin ella este documento estaría
citando código probado únicamente con mocks como si fuera una demostración
en AWS, el error exacto que `AGENTS.md` prohíbe desde el primer día del
proyecto (capítulo 2). La conclusión práctica para un equipo que reutilice
este enfoque: una auditoría de cierre programada, no sólo checks de CI, es
la que realmente hace cumplir la regla de "sin evidencia no hay cierre"
sobre trabajo que ya se consideraba terminado — y que cerrar con un
hallazgo documentado y sin corregir es preferible a dejarlo oculto bajo un
check en verde.

## Trabajo futuro

1. Confirmar la recepción del correo de galerías con un segundo proveedor de
   correo independiente (Google Workspace o Microsoft 365, además del buzón
   único ya verificado) — el criterio que #86 dejó explícitamente pendiente
   en #98 y que su cierre no llegó a ejercer.
2. Corregir el timeout real de borrado con alto fan-out: paginar/lotear el
   borrado de matches e ítems espejo en `deleteEventPhoto`
   (`BatchWriteCommand` en vez de `DeleteCommand` individuales) y revisar el
   timeout de 3 s de la Lambda `delete_photo` frente al volumen real de
   matches por fotografía (hallazgo de la PR #141 de la issue #49).
3. Añadir a `writeMatch` una condición que verifique que la fotografía sigue
   existiendo antes de escribir un match, cerrando la ventana de carrera que
   permite "resucitar" un match contra una foto ya borrada por un backfill o
   un disparo S3 tardío (mismo hallazgo; coordinar con la limpieza de #89 y
   los envíos de #86).
4. Unificar el código de respuesta (`404` frente a `410`) entre
   `publicEnrollment.ts` y `createPhotoUploads` ante un evento cerrado o con
   retención vencida (hallazgo de la PR #148 de la issue #89), y decidir cuál
   de los dos es el contrato correcto antes de cambiar ninguno.
5. Decidir y documentar en un ADR la migración de colecciones Rekognition
   heredadas a nombres aislados por entorno (ADR-015).
6. Fuera del alcance de este MVP académico, y no planificado: revisión legal
   formal de protección de datos, campañas de marketing por correo o
   SMS a los asistentes, escalado más allá de un evento concurrente y
   operación en producción con soporte 24/7.
