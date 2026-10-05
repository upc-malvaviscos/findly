# Análisis de decisión: DynamoDB frente a PostgreSQL/RDS (issue #49)

<!-- requirement: REQ-DATABASE-DECISION-INVENTORY -->

Estado: **decisión abierta; inventario actualizado, sin autorización de migración.**
ADR-002 sigue vigente. ADR-019 mantiene DynamoDB únicamente para #86; no decide
los contratos de #87/#89 ni cierra #49. Esta revisión no cambia código, claves,
índices, Terraform, IAM o AWS, ni publica un ADR nuevo.

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
| [#105](https://github.com/upc-malvaviscos/findly/issues/105) Invitaciones administrativas   | Altas Cognito y primer acceso con contraseña temporal.                                                          | Cognito conserva usuarios/contraseñas fuera de DynamoDB/Terraform. Código y pruebas sintéticas integrados; aceptación real pendiente según issue.         |
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

No se han ejecutado estos escenarios. Antes de recursos AWS nuevos deben
aprobarse contratos, límites de coste/tiempo, permisos y limpieza. Una prueba
PostgreSQL local puede comparar integridad/consultas, pero no prueba operación
ni coste RDS. SES sigue requiriendo su aceptación específica de #98 cualquiera
que sea la base elegida.

## 8. Recomendación provisional y criterio de decisión

Mantener la implementación actual mientras se resuelve #49 evita una migración
sin evidencia; **no equivale a decidir DynamoDB para todo el backlog**.

El inventario no demuestra una necesidad de SQL para informes/personas globales.
Sí aumenta el coste de diseño e integridad de DynamoDB en #87/#89. PostgreSQL
puede simplificar especialmente el acceso inverso y las relaciones, a cambio
de migración, conexiones, red y operación persistente.

Antes de elegir definitivamente:

1. Acordar contratos de #87/#89 y edición/retención, con garantías precisas.
2. Comparar diseños completos, incluida limpieza de datos existentes.
3. Resolver la incertidumbre de fan-out/convergencia con evidencia sintética y
   objetivos de volumen/latencia/coste acordados.
4. Verificar factibilidad operativa/CI del candidato RDS si sigue siendo viable.
5. Obtener decisión explícita; sólo entonces confirmar/sustituir ADR-002 y
   crear el trabajo de implementación/migración correspondiente.

No usar SES pendiente, un bug de refresco o la experiencia de otra aplicación
como prueba a favor de una base. Tampoco usar CI verde del recorrido anterior
como prueba de los contratos nuevos.

## 9. Checklist de #49 y pendientes

| Criterio                                                             | Estado de esta entrega                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Inventario completo y separación de requisitos/hipótesis             | Actualizado: 12 issues, secciones 1–2.                                                |
| Matriz de acceso/consistencia y estado trazado a código/tests/IaC    | Actualizada para lo confirmado; contratos de #87/#89 siguen abiertos.                 |
| Alternativas, integridad, privacidad, red, migración, evolución y CI | Comparación documental actualizada; importes/capacidad y factibilidad RDS pendientes. |
| Prototipos/benchmarks ante incertidumbre material                    | Diseñados como propuesta; no ejecutados ni acreditados.                               |
| Recomendación con criterios sin cambiar implementación               | Provisional; no es decisión final.                                                    |
| Responsable aprueba una opción explícita                             | Pendiente.                                                                            |
| ADR e implementación/migración tras aprobación                       | Pendiente; ADR-002 vigente y #49 abierta.                                             |

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
