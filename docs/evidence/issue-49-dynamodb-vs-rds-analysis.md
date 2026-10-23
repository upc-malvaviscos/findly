# Análisis de decisión: DynamoDB frente a PostgreSQL/RDS (issue #49)

<!-- requirement: REQ-DATABASE-DECISION-INVENTORY -->

## Síntesis vigente — 2026-10-23

Las issues #49 y #89 están cerradas. Los apartados 1–10 conservan la investigación y
los resultados de su fecha; los `500` y las tareas propuestas no describen
el código actual `7fc0376`. PR #143/#144 corrigieron timeout/lotes y
comprobación de existencia, con aceptación AWS histórica; PR #146/#147/#148
completaron la entrega administrativa. El responsable confirma que el código
actual está desplegado. No se ha ejecutado AWS nuevo en esta auditoría.

El tombstone posterior de #121 conserva PK; `attribute_exists(PK)` no verifica
`deletedAt` ni el TTL lógico. Ese riesgo se sigue en
[#166](https://github.com/upc-malvaviscos/findly/issues/166), separado de la
decisión de conservar DynamoDB. Detalle y límites en la [auditoría del 2026-10-23](2026-10-23-code-truth-sync.md).

Estado: **motor de persistencia y contratos de acceso decididos (ADR-022,
2026-10-12); #87 y el ítem espejo de #89 ya están implementados; el
benchmark de convergencia/fan-out que mantenía #49 abierta (sección 9) ya
se ejecutó y está documentado en la sección 7 (2026-10-16). #49 puede
cerrarse; el resto de #89 (edición de evento, UI, autorización de los
nuevos endpoints) sigue como tarea propia de esa issue, no de ésta.**
ADR-002 sigue vigente. ADR-019 mantiene DynamoDB únicamente para #86.
[ADR-022](../adr/ADR-022-confirm-dynamodb-persistence.md) confirma DynamoDB
para todo el backlog abierto por motivos técnicos independientes de la
política del proyecto: el patrón de acceso confirmado en las secciones 2–4
es casi todo por clave, sin JOINs ni informes transversales; la concurrencia
de Lambda sobre RDS exigiría RDS Proxy para no agotar conexiones; y el coste
on-demand de DynamoDB se ajusta a una demo que no corre de forma continua,
frente al coste por instancia de RDS. Esa conclusión coincide, de forma
independiente, con la prohibición de AGENTS.md sobre servicios de coste fijo
(RDS/EC2/NAT/VPC); por eso no se ejecuta el ciclo efímero de RDS que
proponía esta revisión en su sección 7 — mediría una diferencia que el
diseño de ambos motores ya hace predecible. ADR-022 también fija los
contratos de acceso de #87 (backfill tras ENROLLED) y #89 (ítem espejo
foto→match); ambos están implementados y verificados con AWS real (PR #120,
PR #129 y PR #139). El benchmark de fan-out (sección 7) confirma que el
ítem espejo resuelve la integridad de datos, pero descubre un hallazgo
operativo real para #89: `deleteEventPhoto` agota su timeout de Lambda
(3 s) ya con 100 matches en una sola foto, dejando ítems huérfanos — un
problema de implementación (timeout/algoritmo de borrado), no del motor
elegido.

## 1. Fuentes, alcance e instantánea

Revisión del 2026-10-05. Base de código: `main` en
`34c15b7cde8c2423c4dd7ceb4f8e8463143c4f1d`. Inventario GitHub obtenido a las
20:49:24 Europe/Madrid: **12 issues abiertas**, enumeradas en la sección 2.
La consulta se repitió después de la integración de #110: #109 ya estaba
cerrada y no forma parte del inventario final.

Método reproducible:

```sh
gh issue list --repo upc-malvaviscos/findly --state open --limit 100 \
  --json number,title,body,updatedAt,url
git rev-parse HEAD
```

Se contrastaron los cuerpos/checklists con specs 02/09/12/18/20/21/22/23,
README, ADR-002/007/011/013/014/015/019/021, handlers, claves, tests y Terraform.
El estado de una issue no demuestra implementación ni despliegue. **Código**
significa que existe una implementación trazable; **pendiente** conserva los
criterios no acreditados. No se han ejecutado benchmarks ni pruebas AWS en
esta revisión.

Esta edición sustituye el inventario histórico de PR #63, que describía
inscripción, emisión de tokens y GSI1 como ausentes y matching/purga como no
conectados. Esas afirmaciones ya no describen la base revisada. El histórico
sigue disponible en Git; no se utiliza como prueba del estado actual.

## 2. Inventario completo de issues abiertas

| Issue                                                                                       | Requisito confirmado                                                                                            | Efecto sobre persistencia y estado                                                                                                                        |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#10](https://github.com/upc-malvaviscos/findly/issues/10) Consentimiento y borrado         | Revocación, limpieza de inscripción/selfie/FaceId/matches/tokens; retención y reintentos verificables.          | Alto: localizadores durables, barreras y limpieza entre servicios. DELETE y purga existen; siguen pendientes criterios de aceptación, incluido Scheduler. |
| [#13](https://github.com/upc-malvaviscos/findly/issues/13) Observabilidad y FinOps          | Logs sin PII, alarmas, presupuesto y evidencia del canal/aviso.                                                 | Coste y operación: medir también proyecciones, índices, reintentos y recursos de RDS. No exige informes SQL de negocio.                                   |
| [#18](https://github.com/upc-malvaviscos/findly/issues/18) Memoria, ADR y runbook           | Documentar arquitectura y recorrido ampliado realmente verificados.                                             | Documental: debe reflejar la decisión aprobada, sin añadir consultas o entidades.                                                                         |
| [#49](https://github.com/upc-malvaviscos/findly/issues/49) Decisión de persistencia         | Comparar alcance completo, acceso, integridad, privacidad, coste y CI.                                          | Decisión transversal; no autoriza implementar candidatos ni migrar.                                                                                       |
| [#70](https://github.com/upc-malvaviscos/findly/issues/70) Auditoría de cierres             | Completar aceptación AWS y sincronización de criterios históricos.                                              | Verificación: no define una tabla de auditoría de negocio ni informes nuevos.                                                                             |
| [#86](https://github.com/upc-malvaviscos/findly/issues/86) Correo manual de galerías        | Email obligatorio, elegibilidad, reenvío intencionado, idempotencia, progreso, enlaces y supresión.             | Alto: operación y destinatario durables, tokens adicionales y referencias inversas. Código integrado con ADR-019; aceptación externa pendiente en #98.    |
| [#87](https://github.com/upc-malvaviscos/findly/issues/87) Matching en ambos órdenes        | Selfie contra fotos previas, foto contra inscripciones previas, convergencia simultánea, paginación y barreras. | Alto: lectura inversa y continuación/reconciliación durable. El recorrido nuevo tras ENROLLED y su convergencia siguen por diseñar/verificar.             |
| [#88](https://github.com/upc-malvaviscos/findly/issues/88) Refresco, descarga y compartir   | Nuevos matches visibles, descarga autorizada y mismo enlace compartible con capacidad de borrado.               | Bajo si conserva token/matches actuales. Descarga y compartir no requieren nuevas entidades. Corrección de refresco parcial en #107; resto pendiente.     |
| [#89](https://github.com/upc-malvaviscos/findly/issues/89) Edición y borrado administrativo | Editar evento, paginar fotos, eliminar foto y todos sus matches, borrar evento sin resurrección.                | Alto: foto→matches no tiene acceso directo actual; estado durable de borrado y compatibilidad de retención por acordar.                                   |
| [#98](https://github.com/upc-malvaviscos/findly/issues/98) SES y entregabilidad             | DNS/identidad, sandbox, HTTPS, permisos, recuperación/feedback y recepción/apertura real.                       | Verifica el modelo de #86; no exige una base distinta. No confundir invitaciones Cognito con correo SES de galerías.                                      |
| [#105](https://github.com/upc-malvaviscos/findly/issues/105) Invitaciones administrativas   | Altas Cognito y primer acceso con contraseña temporal.                                                          | Cognito conserva usuarios/contraseñas fuera de DynamoDB/Terraform. Código, pruebas sintéticas y primer acceso en producción completados; issue cerrada.   |
| [#107](https://github.com/upc-malvaviscos/findly/issues/107) Refresco y diagnóstico         | Mostrar matches al refrescar y diagnosticar sin datos privados.                                                 | Sin cambio de modelo: #108 integrada en la base revisada; su publicación/aceptación no se infiere del merge.                                              |

**No son requisitos confirmados por esas issues:** persona global compartida entre
eventos, deduplicación por email, informes ad hoc, búsqueda transversal por
asistente, marketing, historial de versiones del texto de consentimiento o
separación propietario/lector de galerías. #10 sí requiere consentimiento
auditable y revocación; el formato de una eventual historia/versionado debe
acordarse, no inferirse como obligación de crear personas globales.

## 3. Modelo actual y trazabilidad

| Patrón existente            | Acceso y garantías en el código                                                                                                                  | Fuentes                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Eventos admin/públicos      | Evento por clave; listado paginado por GSI2 `ENTITY#EVENT`; filtro público OPEN. GSI2 es eventual.                                               | `adminEvents.ts`, `publicEvents.ts`, tests homónimos y módulos admin/public-enrollment.        |
| Alta de inscripción         | Transacción condicionada a evento OPEN: REG, TOKEN y RETENTION sin TTL. Polling autorizado por token; inscripción por evento, no persona global. | `publicEnrollment.ts`, ADR-011/014, `publicEnrollment.test.ts`.                                |
| Indexación de selfie        | Claim/lease, transición condicionada y persistencia de FaceId/GSI1; comprobaciones de caducidad/borrado y recuperación facial durable.           | `selfieIndexer.ts`, `retentionCleanup.ts`, tests de indexación y módulo selfie-indexer.        |
| Matching provocado por foto | GSI1 FaceId→REG; match idempotente `REG#id/MATCH#photoId` con condición transaccional sobre inscripción.                                         | `photoMatcher.ts`, `photoMatcher.test.ts`, módulo photo-matching. No acredita #87 completo.    |
| Galería                     | Token por hash; matches por REG y lecturas de fotos por EVENT; URLs S3 temporales. Fotos siguen en S3, reconocimiento en Rekognition.            | `gallery.ts`, `gallery.test.ts`, módulo gallery-reader y claves compartidas.                   |
| Borrado/retención           | Barrera de revocación, localizador RETENTION sin TTL y limpieza externa reintentable. Purgador consulta GSI2, no Scan global.                    | `deleteRegistration.ts`, `retentionPurger.ts`, ADR-014 y tests/módulos correspondientes.       |
| Correo manual               | `EVENT#id/EMAIL#uuid`, `REG#id/EMAIL#uuid`, token por hash y referencia inversa `REG#id/TOKEN#hash`; revisiones/checkpoints y estados inciertos. | `galleryEmail.ts`, `galleryEmailFeedback.ts`, ADR-019, tests de correo y módulo gallery-email. |

Rutas relativas al repositorio: handlers en `src/lambdas/`, tests en
`tests/lambdas/`, claves en `src/shared/lib/dynamoKeys.ts`, tipos en
`src/shared/types/entities.ts` y módulos en `infra/modules/`.
La evidencia desplegada de inscripción/matching/galería/borrado y sus límites
está en el catálogo `docs/evidence/`. La aceptación del módulo SES sigue en #98.

Correcciones al análisis antiguo: GSI1 tiene escritor; REG/TOKEN se emiten;
los handlers están conectados al stack; el filtro público existe; la purga
sustituyó Scan por Query GSI2 y usa localizadores independientes del TTL.
No se propone un índice de caducidad como si ya fuera necesario o existente.
GSI2 sigue concentrando el listado en una partición lógica; su coste/volumen
requiere medición, no una afirmación de escala suficiente sin datos.

## 4. Matriz de acceso y consistencia del alcance pendiente

Variables: E eventos, R inscripciones/evento, P fotos/evento, M matches/foto,
T tokens/inscripción y B bytes/ítem. No hay medidas de volumen o latencia
aprobadas; no se presentan valores de demo como capacidad de producción.

| Caso / issues                             | Consulta o escritura necesaria                                                                  | DynamoDB candidato                                                                                                            | PostgreSQL candidato                                                                   | Garantía por demostrar                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Fotos previas de una inscripción (#87)    | Listar todas las PHOTO del EVENT, por páginas; registrar continuación.                          | Query `PK=EVENT#id AND begins_with(SK, PHOTO#)` ya expresable; falta trabajo durable/trigger posterior a ENROLLED.            | Índice `photos(event_id, id)` y job paginado por inscripción.                          | La carrera foto/selfie no deja pares sin procesar; duplicados convergen.                                |
| Match por inscripción/foto (#87/#89)      | Crear una sola coincidencia y comprobar estados vigentes de evento/REG/PHOTO.                   | Put/ConditionCheck transaccionales; si se añade referencia inversa, escribirla en la misma transacción.                       | UNIQUE(registration_id, photo_id), FKs y transacción con protocolo de bloqueo/estado.  | Borrado concurrente y jobs tardíos no recrean datos. SQL no evita por sí solo una carrera mal diseñada. |
| Eliminar foto y sus matches (#89)         | Encontrar todos los REG afectados por eventId/photoId.                                          | Falta acceso inverso directo. Comparar ítems `PHOTO#eventId#photoId/MATCH#registrationId` frente a GSI; ambos son propuestas. | Índice `matches(event_id, photo_id, registration_id)`; DELETE relacional.              | Barrera antes del recorrido, paginación, referencias históricas/backfill y limpieza tras fallos.        |
| Eliminar evento (#89/#10)                 | Bloquear operaciones; recorrer PHOTO/REG/RETENTION/EMAIL y dependencias fuera de EVENT.         | Estado durable de borrado y cursor; localizadores/referencias inversas, limpieza acotada por páginas.                         | Estado de evento, FKs/cascadas en DB y jobs/outbox para S3/Rekognition/colas.          | No huérfanos ni resurrección; sin transacción gigante ni limpieza externa ficticiamente atómica.        |
| Editar fecha/retención (#89)              | Validar campos; actualizar evento/listado y definir efecto sobre TTL/tokens previos.            | Actualizar clave GSI2 si cambia fecha; revisar registros afectados según contrato.                                            | Actualizar filas/índices; también requiere decidir compatibilidad de expiraciones.     | No prolongar consentimiento/token silenciosamente; política pendiente de acuerdo.                       |
| Correo y reintentos (#86/#98)             | Paginar REG del evento, comprobar matches/fotos, persistir operación/claim/contadores y tokens. | Modelo ADR-019 existe; costes crecen con revalidación, páginas y tokens.                                                      | Tablas jobs/recipients/tokens y transacciones; SES queda fuera.                        | Aceptación incierta sin reenvío automático; recuperación y feedback reales pendientes.                  |
| Revocación y expiración (#10/#86/#88/#89) | Resolver tokens de REG; barrera y limpieza de datos, objetos y FaceIds.                         | Referencias inversas y localizador sin TTL; lecturas de estado para autorización.                                             | FK/cascada dentro de DB; estado durable para limpieza externa.                         | TTL no prueba borrado inmediato; URLs S3 emitidas pueden durar hasta expiración.                        |
| Descarga/compartir (#88/#107)             | Token→REG→MATCH→PHOTO; autorizar archivo y refrescar sin sesión.                                | Reutiliza claves existentes; no exige nuevo índice ni persona global.                                                         | JOIN equivalente.                                                                      | Rechazar foto ajena y revocación; respuesta/descarga S3 real.                                           |
| Consentimiento auditable (#10)            | Acreditar concesión y retirada; acordar qué evidencia debe conservarse y su retención.          | Timestamp/barrera actuales; historia/versionado sólo tras contrato aprobado.                                                  | Consentimiento por inscripción; tabla de eventos de consentimiento sólo si se acuerda. | No conservar PII indefinidamente ni prometer historial que no existe.                                   |

### Acceso inverso foto→matches: comparación concreta

El problema de #89 es **confirmado**, no un informe hipotético. Con las claves
actuales no se puede consultar directamente todos los matches de una foto.

- **Referencia inversa en la tabla:** permite Query por foto con lectura fuerte.
  Añade un ítem por match y escritura/borrado coordinados. Requiere backfill de
  matches existentes y limpieza del índice lógico en DELETE/purga.
- **GSI sobre matches:** evita el ítem espejo, pero añade atributos/índice y
  coste de escritura. Su consistencia eventual no puede ser la única garantía
  de completar un borrado. Requiere barrera en la foto, comprobaciones de
  escrituras y reconciliación tras retrasos del índice.
- **PostgreSQL:** índice inverso y restricciones simplifican la integridad en
  DB. La eliminación de S3/Rekognition, mensajes tardíos y respuestas de SES
  siguen exigiendo barreras y trabajo durable.

Son alternativas para decidir. No se han implementado, medido ni aprobado.
Una transacción DynamoDB está limitada a 100 acciones/4 MB; ningún candidato
puede tratar un evento sin límite como una única transacción. Tampoco una
transacción SQL debería incluir llamadas externas o borrados masivos sin
evaluar bloqueos, duración y recuperación.

## 5. Candidatos de persistencia y evolución

### A. DynamoDB con contratos ampliados

Conservar los patrones actuales y acordar continuación/convergencia de #87 y
acceso inverso/barreras de #89. No basta decir que todas las consultas son por
clave: hay que diseñar y probar las nuevas claves, referencias y su limpieza.

IAM por tabla/índice, sin contraseña de base ni conexiones de aplicación.
Añadir un GSI requiere evolución compatible de atributos y comprobar cobertura;
los ítems inversos requieren backfill idempotente. Durante transición hay que
impedir borrados incompletos por filas antiguas aún sin proyección.

### B. PostgreSQL en RDS

Modelo mínimo derivado de Findly, sin copiar entidades de otro proyecto:

| Tabla candidata                     | Claves, relación e índice                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| events                              | PK event_id; campos y estado; índice para listado público/fecha.                                              |
| registrations                       | PK registration_id; FK event_id; consentimiento/email/estado/expiración; índice por evento.                   |
| photos                              | PK (event_id, photo_id); FK event_id; objeto/estado/expiración.                                               |
| matches                             | UNIQUE(registration_id, photo_id); relaciones que garanticen mismo evento; índices por REG y por foto/evento. |
| gallery_tokens                      | PK token_hash; FK registration_id; expiración; sin token en claro.                                            |
| email_operations / email_recipients | Operación por evento/UUID y destinatario único por operación/REG; claim, checkpoint/revisión/contadores.      |
| cleanup_jobs / matching_jobs        | Estado, cursor, lease y deduplicación para trabajo externo y ambos órdenes.                                   |

No hay tabla persons necesaria para este alcance. Las FKs pueden mejorar
integridad referencial; los protocolos de concurrencia, claims e idempotencia
siguen siendo necesarios. La transacción de DB no incluye SES/S3/Rekognition.

Migrar exigiría diseñar esquema y migraciones versionadas, backfill desde
DynamoDB sin reconstruir tokens, preservar enlaces/expiraciones y jobs, validar
recuentos sin publicar datos, decidir cutover/rollback y compatibilidad de
lecturas/escrituras. **No se autoriza una escritura dual ni una migración.**

RDS necesita diseño de VPC/subredes/seguridad, conexiones Lambda/pooling,
credenciales o autenticación apropiada, TLS, backups/restauración y permisos.
NAT, endpoints de interfaz y RDS Proxy **no se presuponen obligatorios**:
dependerán de las llamadas externas y del diseño elegido; su necesidad y
coste deben compararse antes de decidir. Cambia ADR-002 y la política vigente
de coste fijo, por lo que requiere aprobación explícita.

### C. Proyección analítica separada

No hay informe transversal confirmado en las 12 issues. No se justifica añadir
otro almacén para resolver #87/#89. Sólo reevaluar si aparece una consulta real
de informes; cualquier copia de PII necesitaría su propio borrado/retención.

## 6. Coste, seguridad, operación y CI comparables

No se calculan importes sin tamaño de datos, volumen, región/configuración y
presupuesto aceptados. No se promete coste cero ni suficiencia de escala.

| Dimensión                   | DynamoDB ampliado                                                                       | PostgreSQL/RDS                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Coste base                  | Peticiones on-demand, almacenamiento, índices y backups habilitados.                    | Tiempo de instancia, almacenamiento y backups; red/proxy si se eligen.                                          |
| Coste incremental relevante | Referencia inversa por match o GSI; backfill; R/P/M/T y revalidaciones SES; reintentos. | Índices/escrituras, duración de jobs, conexiones y migración; no eliminar costes comunes de S3/Rekognition/SES. |
| Integridad                  | Condiciones/transacciones y referencias mantenidas por aplicación.                      | FKs, UNIQUE e índices; reglas de estado y efectos externos mantenidos por aplicación.                           |
| Seguridad                   | IAM sobre tabla/índices, sin secretos de DB.                                            | Red y acceso DB, gestión de identidad/secretos, TLS y permisos.                                                 |
| Recuperación                | Checkpoints, PITR según entorno, backfill/proyecciones reconciliables.                  | Backups/PITR según configuración, migraciones, restauración y replay/outbox.                                    |
| Desarrollo/CI               | Floci y stack AWS efímero existentes; ampliar aceptación del nuevo acceso.              | PostgreSQL local y prueba de aprovisionar/migrar/probar/destruir RDS; duración/coste aún no demostrados.        |

Para estimar: fijar E/R/P/M/T/B, mezcla de lecturas/escrituras, concurrencia,
retención y objetivo de latencia; comparar dos diseños con la misma semántica.
Registrar consumo de DB, llamadas AWS comunes, recuperación tras fallos,
complejidad de evolución y coste de PR efímera. No provocar gasto para probar
un aviso de Budgets (#13), ni asumir créditos/capa gratuita del otro proyecto.

## 7. Incertidumbre material y pruebas para resolverla

**Se retira la conclusión histórica «no hay incertidumbre material».** Las
issues #87 y #89 exigen convergencia y acceso inverso/borrado sin contrato
completo. Esto justifica diseñar una prueba comparable, no autoriza recursos.

| Escenario sintético propuesto                                                    | Medida y aceptación que deben acordarse                                                                                                                                 |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foto con 100, 1.000 y 10.000 matches, varias páginas; borrar durante escrituras. | Solicitudes/bytes, latencia de bloqueo y limpieza, huérfanos y resurrección; comparar ítem inverso, GSI y SQL. Los tamaños son pruebas propuestas, no volumen esperado. |
| Foto y selfie simultáneas con pausas/fallos después de persistir/indexar.        | Cero pares perdidos tras recuperación; matches únicos; trabajo y llamadas Rekognition redundantes.                                                                      |
| Borrado interrumpido y reentregas tardías, incluso tras expiración de REG.       | Reanudar desde cursor/localizador; ausencia de tokens/matches/objetos recreados.                                                                                        |
| Cambios de fecha/retención con tokens y correo en cola.                          | Cumplir política de compatibilidad aprobada; no ampliar retención implícitamente.                                                                                       |
| Ciclo efímero del candidato RDS.                                                 | Aprovisionar, migrar, probar y destruir; tiempos, coste y limpieza demostrados dentro de límites previamente acordados.                                                 |

### Resultado del benchmark real de fan-out y borrado concurrente (2026-10-16)

Ejecutados el primer y el tercer escenario de la tabla anterior (ya con el
ítem espejo de ADR-022 implementado) contra el sandbox real (cuenta
`912415493378`), con `scripts/deployed-issue-49-fanout-benchmark.mjs`. Los
escenarios de coste/migración de RDS y los de correo/retención no aplican:
RDS quedó descartado por diseño en ADR-022, y correo/retención no cambian
con el ítem espejo. Salida completa en
[`docs/evidence/issue-49-fanout-benchmark-run.json`](issue-49-fanout-benchmark-run.json).

- **Fan-out a escala (100 y 1.000 matches en una sola foto):** se sembraron
  directamente en DynamoDB los pares match+espejo (no vía Rekognition, que
  habría exigido cientos/miles de inscripciones reales) y se llamó al
  `DELETE /admin/events/{eventId}/photos/{photoId}` real. **Las dos
  ejecuciones devolvieron `500` por timeout de Lambda**, confirmado en el
  log real:

  ```text
  REPORT RequestId: e8ac46ff-...  Duration: 3000.00 ms  Billed Duration: 3412 ms  Status: timeout
  REPORT RequestId: 79fe52ee-...  Duration: 3000.00 ms  Billed Duration: 3000 ms  Status: timeout
  ```

  `infra/modules/admin-api/main.tf` da a `delete_photo` un timeout de **3 s**
  (frente a 60 s para `delete_event`), y `deleteEventPhoto`
  (`src/lambdas/adminEvents.ts`) borra cada match y su espejo con dos
  `DeleteCommand` individuales por inscripción dentro de un `Promise.all`,
  no con `BatchWriteCommand`. Con 100 matches ya no da tiempo a completar
  las ~200 escrituras de borrado: la consulta posterior mostró 100 ítems
  espejo y la fila de la foto todavía presentes (huérfanos reales, no
  hipotéticos), aunque una muestra de 5 claves de match sí se habían
  borrado — confirma limpieza parcial, no atómica, ante el timeout.

- **Borrado real durante un match real en curso:** una inscripción
  `ENROLLED` real, subida de foto real (dispara `photoMatcher.ts`) en
  carrera (`Promise.all`) con el `DELETE` administrativo de esa misma foto.
  El borrado devolvió `204` y, 20 s después, ni el match ni su espejo
  existían — sin resurrección en este caso concreto. No se fuerza aquí la
  ventana exacta entre `IndexFaces`/`SearchFaces` (ya completados) y
  `writeMatch` (todavía no comprometido) sin modificar el código de
  producción para instrumentarla; **`writeMatch` (`src/lambdas/lib/
matching.ts`) solo valida el estado de la inscripción, nunca si la foto
  sigue existiendo**, así que esa ventana más estrecha queda como riesgo de
  diseño identificado, no descartado, para quien implemente el resto de
  #89.

**Conclusión del benchmark para #49:** el ítem espejo de ADR-022 resuelve la
pregunta de _integridad de datos_ que motivaba la incertidumbre (fan-out
foto→matches sin `Scan`, consulta por clave). El hallazgo real es
_operativo_, no de motor: un timeout de 3 s y un patrón de borrado sin
`BatchWriteCommand` no escalan más allá de ~100 matches por foto en el
código actual. Una tabla PostgreSQL con el mismo patrón ingenuo (borrado
fila a fila dentro de una función con el mismo timeout) tendría el mismo
problema — no es un argumento a favor de RDS, es una corrección pendiente
de implementación para #89 (subir el timeout de `delete_photo` y/o sustituir
el borrado individual por `BatchWriteCommand`, igual que ya hace el
sembrado de este mismo benchmark).

No se ejecutó el escenario de borrado interrumpido con reentregas tardías
tras expiración de REG (cuarta fila de la tabla): depende del resto de la
implementación de #89 (edición/retención), fuera del alcance acotado de
esta entrega. El ciclo efímero de RDS tampoco se ejecuta, por los motivos ya
fijados en ADR-022. Antes de recursos AWS nuevos para esos escenarios deben
aprobarse contratos, límites de coste/tiempo, permisos y limpieza. SES
sigue requiriendo su aceptación específica de #98 cualquiera que sea la
base elegida.

## 8. Recomendación final

DynamoDB se mantiene para todo el backlog abierto (ADR-022, 2026-10-12). Con
el benchmark de la sección 7 ejecutado, **no queda incertidumbre material
pendiente de resolver para cerrar #49**: la pregunta de integridad
(fan-out/convergencia) tiene respuesta -- el ítem espejo la resuelve -- y el
único hallazgo real (timeout de `delete_photo`) es una corrección de
implementación para #89, no un argumento de motor. El inventario tampoco
demuestra una necesidad de SQL para informes/personas globales.

Queda para #89, no para #49:

1. Subir el timeout de `delete_photo` y/o sustituir sus `DeleteCommand`
   individuales por `BatchWriteCommand`, antes de confiar en ese endpoint
   con eventos reales de más de ~100 matches por foto.
2. Evaluar si `writeMatch` debe validar también que la foto sigue existiendo
   (no solo la inscripción) para cerrar la ventana de diseño señalada en la
   sección 7, o si alguna otra barrera ya acordada la cubre.
3. El resto de su propio alcance: edición de evento, UI, autorización y
   pruebas E2E -- sin relación con la elección de motor.

No usar SES pendiente, un bug de refresco o la experiencia de otra aplicación
como prueba a favor de una base. Tampoco usar CI verde del recorrido anterior
como prueba de los contratos nuevos.

## 9. Checklist de #49 -- estado final

| Criterio                                                             | Estado final                                                                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventario completo y separación de requisitos/hipótesis             | Completo: 12 issues, secciones 1-2.                                                                                                                                             |
| Matriz de acceso/consistencia y estado trazado a código/tests/IaC    | Completa; contratos de #87/#89 implementados y verificados con AWS real.                                                                                                        |
| Alternativas, integridad, privacidad, red, migración, evolución y CI | RDS descartado por patrón de acceso/concurrencia y coste (ADR-022); coincide con la política de AGENTS.md.                                                                      |
| Prototipos/benchmarks ante incertidumbre material                    | **Completo (2026-10-16)**: fan-out 100/1.000 y borrado-durante-match real, sección 7. RDS no aplica.                                                                            |
| Recomendación con criterios sin cambiar implementación               | Motor y contratos de acceso decididos (ADR-022); el hallazgo de timeout queda para #89, no cambia esta decisión.                                                                |
| Responsable aprueba una opción explícita                             | Aprobado 2026-10-12: DynamoDB, ítem espejo (#89) y backfill tras ENROLLED (#87).                                                                                                |
| ADR e implementación/migración tras aprobación                       | ADR-022 registrado. #87 (PR #129/#139) y el ítem espejo de #89 (PR #120) implementados y verificados con AWS real. #49 cierra; el resto de #89 sigue abierto como issue propia. |

## 10. Referencias técnicas primarias

Consultadas el 2026-10-05; respaldan capacidades/límites, no resultados del proyecto:

- [Modelado por patrones de acceso DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-modeling-nosql.html).
- [Transacciones DynamoDB y sus límites](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html).
- [Consistencia de lecturas e índices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html).
- [TTL es eliminación eventual](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html).
- [Restricciones PostgreSQL](https://www.postgresql.org/docs/current/ddl-constraints.html).
- [RDS en VPC](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html).
- [Precios DynamoDB](https://aws.amazon.com/dynamodb/pricing/) y
  [RDS PostgreSQL](https://aws.amazon.com/rds/postgresql/pricing/).
