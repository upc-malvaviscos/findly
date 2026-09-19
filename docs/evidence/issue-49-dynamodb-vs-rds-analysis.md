# Análisis de decisión: DynamoDB frente a PostgreSQL/RDS (issue #49)

Estado: **análisis para decisión; la decisión sigue abierta.** Este documento no
autoriza migración, cambios de código, Terraform, AWS ni ADR, y no relaja la
política de coste fijo de [ADR-002](../adr/ADR-002-serverless-without-rds-or-vpc.md).
Un ADR que mantenga o sustituya ADR-002 sólo se publica tras la aprobación
explícita de la persona responsable.

Fuentes: `specs/02-domain-model-api-contracts-and-dynamodb-keys.md`, ADR-002,
ADR-005, ADR-007, `src/shared/lib/dynamoKeys.ts`, `src/lambdas/*.ts`,
`tests/`, `infra/modules/*` e `infra/ephemeral`. Método: lectura estática del
repositorio en `main` (commit posterior a #62). No se ha ejecutado ningún
benchmark ni se han creado recursos.

## 1. Estado actual trazado al código

Convención: **Implementado** = handler + test + módulo Terraform existen;
**Código sin desplegar** = existe código/módulo pero `infra/ephemeral` y los
roots de entorno no lo instancian; **Especificado** = sólo spec/DTO; **Sin
patrón** = no hay clave ni índice definido.

| Entidad / patrón                                          | Clave (spec 02)                                      | Escritura                                                                                 | Lectura                                                 | Tests                                           | Terraform                             | Estado                                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Evento                                                    | `EVENT#id` / `METADATA`, GSI2 `ENTITY#EVENT`         | `adminEvents.createAdminEvent` (`Put` condicional)                                        | `listAdminEvents` (`Query` GSI2), `gallery` (`Get`)     | `adminEvents.test.ts`                           | `admin-api`, `dynamodb` (GSI2)        | Implementado y desplegado en efímero                                                           |
| Foto de evento                                            | `EVENT#id` / `PHOTO#id`                              | `adminEvents.createPhotoUploads` (`Put` condicional, TTL 30 d)                            | `gallery` (`Get` por foto)                              | `adminEvents.test.ts`, `gallery.test.ts`        | `admin-api`, `gallery-reader`         | Implementado; matching no desplegado                                                           |
| Coincidencia                                              | `REG#id` / `MATCH#photoId`                           | `photoMatcher.writeMatch` (`Put` condicional idempotente)                                 | `gallery` (`Query begins_with`), `deleteRegistration`   | `photoMatcher.test.ts`, `gallery.test.ts`       | `photo-matching` (SQS + DLQ + alarma) | **Código sin desplegar**                                                                       |
| FaceId → inscripción                                      | GSI1 `FACE#faceId` / `REG#id`                        | **Ningún handler escribe GSI1**                                                           | `photoMatcher.findRegistrationIdForFace` (`Query` GSI1) | `photoMatcher.test.ts` (datos sembrados)        | GSI1 existe                           | **Gap:** lo escribiría `SelfieIndexer` (issue #7)                                              |
| Inscripción                                               | `EVENT#id` / `REG#id`                                | **Ningún handler la crea** (`POST /events/{id}/registrations` sólo en `realApi.ts`/mocks) | `deleteRegistration` (`Get`)                            | `deleteRegistration.test.ts`                    | Sin ruta pública                      | **Gap:** especificado, sin backend                                                             |
| Token de galería                                          | `TOKEN#sha256` / `METADATA`                          | **Ningún handler lo emite**                                                               | `gallery`, `deleteRegistration` (`Get`)                 | `gallery.test.ts`, `deleteRegistration.test.ts` | `gallery-reader` (`GET /gallery`)     | **Gap:** emisión sin patrón implementado                                                       |
| Listado público de eventos (`GET /events`, `status=OPEN`) | —                                                    | —                                                                                         | —                                                       | —                                               | —                                     | **Sin patrón** (GSI2 lista todos los eventos; no filtra por `status`)                          |
| Estado de inscripción (`GET /registrations/{id}/status`)  | `REG#` en `EVENT#id`                                 | —                                                                                         | —                                                       | `pollRegistrationStatus.test.ts` (cliente)      | Sin ruta                              | **Gap:** requiere `eventId` para la clave y la ruta sólo trae `registrationId`                 |
| Derecho al olvido                                         | Borra `REG#`, `MATCH#*`, `TOKEN#` + Rekognition + S3 | `deleteRegistration` (secuencia de `Delete`)                                              | —                                                       | `deleteRegistration.test.ts`                    | Sin ruta gestionada                   | Código sin desplegar                                                                           |
| Purga por retención                                       | Colección Rekognition + prefijo S3 del evento        | `retentionPurger` (`Scan` con filtro)                                                     | —                                                       | `retentionPurger.test.ts`                       | `retention-purger` (Scheduler)        | **Código sin desplegar**                                                                       |
| Persona/asistente y asistencia                            | —                                                    | —                                                                                         | —                                                       | —                                               | —                                     | **Sin patrón:** no hay entidad; hoy `Registration` mezcla persona, asistencia y consentimiento |
| Consentimiento (versión, revocación, auditoría)           | `consentTimestamp` en `REG#`                         | —                                                                                         | —                                                       | —                                               | —                                     | **Sin patrón:** no hay versión ni historial ni evento de revocación                            |
| Auditoría / idempotencia de escrituras                    | —                                                    | Sólo `ConditionExpression` puntual y log `registration_erased` sin PII                    | —                                                       | —                                               | —                                     | **Sin patrón** de tabla de auditoría                                                           |
| Informes / reconciliación                                 | —                                                    | —                                                                                         | —                                                       | —                                               | —                                     | **Sin patrón** ni requisito confirmado                                                         |

Hechos relevantes verificados en el código:

- El root efímero sólo instancia `dynamodb`, `uploads-bucket`, `api-gateway`,
  `cognito`, `admin-api` y `gallery-reader`. `photo-matching` y
  `retention-purger` no están instanciados en ningún root.
- `retentionPurger.findExpiredEvents` usa `Scan` con `FilterExpression` sobre
  toda la tabla, lo que contradice el principio "sin Scan" de spec 02 y ADR-007.
- `retentionPurger` borra la colección Rekognition y el prefijo S3, pero **no**
  borra `EVENT#…/METADATA` ni las filas `REG#`, `PHOTO#` o `MATCH#` del evento;
  se apoya en `ttl` de cada fila. `EventEntity` no tiene `ttl`, por lo que un
  evento caducado permanece en la tabla y en el listado admin.
- `deleteRegistration` ejecuta Rekognition → S3 → `Delete` de matches →
  `Delete` de `REG#` → `Delete` de `TOKEN#` como secuencia no atómica; el
  orden hace idempotente el reintento, pero un fallo intermedio deja estado
  parcial que sólo la retención por TTL termina de limpiar.
- La GSI2 tiene una única partición (`ENTITY#EVENT`): es válida para el
  volumen del MVP (decenas de eventos) pero es una _hot partition_ si crece.

## 2. Matriz de casos de uso, consistencia y modelo candidato

Cardinalidad, volumen y latencia son **hipótesis de demostración académica**
(un evento a la vez, decenas de asistentes, cientos de fotos), no medidas.

| Caso                                                | Escrituras / lecturas                                        | Consistencia requerida                                                   | DynamoDB single-table                                                      | PostgreSQL/RDS                                                          |
| --------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Crear/listar eventos admin                          | 1 `Put` condicional / `Query` GSI2                           | Unicidad de `eventId`; lectura eventual aceptable                        | Cubierto (implementado)                                                    | `INSERT … ON CONFLICT`; `SELECT … ORDER BY date`                        |
| Filtrar eventos públicos (`OPEN`)                   | Lectura por `status`                                         | Eventual                                                                 | **Sin índice**: requeriría GSI o filtrar tras `Query` GSI2                 | `WHERE status='OPEN'` con índice parcial                                |
| Crear inscripción + consentimiento                  | 1 escritura (`REG#`) con `attribute_not_exists`              | Unicidad; consentimiento obligatorio antes de aceptar selfie             | Un `Put` condicional cubre unicidad                                        | `UNIQUE` + `CHECK`/FK a consentimiento                                  |
| Consentimiento versionado/revocable                 | Historial append-only + estado actual                        | Auditable, sin PII, orden temporal                                       | Requiere ítems `CONSENT#` versionados o atributo + log; sin patrón hoy     | Tabla `consent_events` append-only con FK                               |
| Estado de inscripción (`UPLOAD_PENDING → ENROLLED`) | Actualización condicional de estado                          | Transición válida (máquina de estados)                                   | `UpdateItem` con `ConditionExpression` sobre `status`                      | `UPDATE … WHERE status = 'PROCESSING'`                                  |
| Indexar selfie / resolver `FaceId`                  | 1 escritura + `Query` GSI1                                   | Idempotente ante reintento de S3/SQS                                     | GSI1 (existe, sin escritor)                                                | Índice único sobre `face_id`                                            |
| Alta de foto y estado de procesamiento              | `Put` condicional                                            | Idempotente                                                              | Cubierto (`PHOTO#`)                                                        | `INSERT … ON CONFLICT`                                                  |
| Matching → galería                                  | N `Put` idempotentes / `Query` por `REG#` + N `Get` de fotos | Idempotencia por `(registrationId, photoId)`                             | Cubierto; galería = 1 `Query` + N `Get` (posible `BatchGet`)               | Un `JOIN` match–photo                                                   |
| Token opaco, expiración, 404/410                    | `Get` por hash                                               | Lectura fuerte de un solo ítem                                           | Cubierto; caducidad lógica + TTL                                           | `SELECT … WHERE token_hash=$1`                                          |
| Derecho al olvido                                   | Borrado en DB + Rekognition + S3                             | **Entre sistemas**: ninguna base garantiza atomicidad con S3/Rekognition | Secuencia idempotente; transacción sólo dentro de DynamoDB                 | `DELETE … CASCADE` en una transacción, pero S3/Rekognition siguen fuera |
| Purga por retención                                 | Buscar eventos caducados y borrar sus datos                  | Completa y verificable                                                   | Hoy `Scan`; necesitaría GSI por caducidad (`EXPIRES#`) o `ttl` en `EVENT#` | `DELETE … WHERE expires_at < now()` con FK en cascada                   |
| Informes/reconciliación                             | Agregaciones ad hoc                                          | Eventual                                                                 | **No natural**: requiere export/proyección                                 | Natural (SQL)                                                           |

Conclusión de la matriz: los patrones de acceso **confirmados** son finitos y
por clave (evento, registro, token, coincidencias por registro, FaceId). El
único caso que DynamoDB no cubre de forma natural es el de informes ad hoc, y
**no hay requisito confirmado** de informes en spec 02 ni en el README.

## 3. Alternativas

### A. Mantener DynamoDB single-table

- **Ajuste:** todos los patrones confirmados son consultas por clave o por GSI.
  Los gaps de la sección 1 son de _implementación_, no una consulta que
  DynamoDB no pueda satisfacer.
- **Integridad:** unicidad e idempotencia con `ConditionExpression` (ya usado
  en eventos, fotos y matches); transacciones (`TransactWriteItems`) para
  escrituras multi-ítem dentro de la tabla. No hay FKs: las referencias
  (`registrationId`, `eventId`) se mantienen por convención y tests.
- **Privacidad/GDPR:** TTL **no** es borrado inmediato (AWS lo documenta como
  proceso en segundo plano, típicamente en el plazo de días), por lo que la
  garantía de borrado demostrable sigue dependiendo de `deleteRegistration` y
  del purgador, no del TTL. Ninguna transacción cubre S3 ni Rekognition.
- **Evolución:** cada patrón nuevo exige diseñar clave/GSI antes de escribir y,
  para datos existentes, un _backfill_ (script o Lambda de reescritura). Los
  GSIs se crean online pero su llenado consume capacidad on-demand.
- **Coste:** on-demand (`PAY_PER_REQUEST`), sin coste fijo; almacenamiento y
  peticiones proporcionales al uso; PITR sólo en `production`.
- **Seguridad/operación:** IAM por acción y por tabla, sin VPC ni secretos, sin
  gestión de conexiones. Observabilidad con CloudWatch (issue #13).
- **Reproducibilidad:** Floci emula DynamoDB (`docs/execution-modes.md`),
  entorno efímero de PR ya despliega la tabla real.
- **Riesgos abiertos:** `Scan` del purgador, `EVENT#` sin TTL, GSI2 de una
  partición, consentimiento sin versión.

### B. DynamoDB operativo + proyección analítica

- Sólo se justifica si aparece un requisito de informes. Opciones: export
  DynamoDB → S3 + consulta bajo demanda con Athena (pago por consulta, sin
  coste fijo), o una proyección por _streams_.
- **Recomendación:** no incorporarla ahora. No hay informe confirmado, y añade
  un segundo almacén con su propio ciclo de vida de datos personales (borrado
  incluido), lo que amplía la superficie GDPR.

### C. PostgreSQL en RDS

Esquema mínimo derivado sólo del modelo Findly (boceto, **no** una propuesta de
implementación):

```sql
events(event_id PK, name, date, retention_days, status, created_at, expires_at)
attendees(attendee_id PK, email NULL)                 -- si se separa persona de asistencia
registrations(registration_id PK, event_id FK, attendee_id FK NULL,
              status, face_id UNIQUE NULL, selfie_key, created_at, ttl_at)
consent_events(id PK, registration_id FK, kind CHECK IN ('granted','revoked'),
               policy_version, occurred_at)            -- append-only
photos(photo_id PK, event_id FK, s3_key, uploaded_at, status)
matches(registration_id FK, photo_id FK, similarity, matched_at,
        PRIMARY KEY (registration_id, photo_id))
gallery_tokens(token_hash PK, registration_id FK, expires_at)
idempotency_keys(key PK, created_at)
```

- **Ventajas reales:** FKs y `ON DELETE CASCADE` hacen el borrado entre tablas
  declarativo y una sola transacción; `UNIQUE`, `CHECK` y joins modelan el
  consentimiento auditable y los informes de forma natural; migraciones
  versionadas (p. ej. herramienta de migraciones) y cambios de consulta sin
  rediseñar claves.
- **Lo que no resuelve:** S3 y Rekognition siguen fuera de la transacción, de
  modo que el derecho al olvido continúa siendo un flujo de varios sistemas.
- **Red y coste fijo:** RDS exige VPC y grupo de subredes con **al menos dos
  AZ**. Una Lambda en VPC pierde el acceso a internet y a servicios AWS salvo
  con NAT Gateway o _VPC endpoints_: los endpoints de gateway de S3 y DynamoDB
  no tienen coste, pero Rekognition, SQS, Secrets Manager y CloudWatch Logs
  necesitan endpoints de interfaz (coste por hora y AZ) o NAT. Esto es
  incompatible con la política vigente (ADR-002, AGENTS.md: sin RDS/VPC/NAT).
- **Conexiones:** cada invocación Lambda concurrente abre conexiones; con
  concurrencia creciente hace falta pooling en aplicación o **RDS Proxy**
  (coste adicional fijo por vCPU/hora).
- **Secretos y seguridad:** credenciales de base de datos en Secrets Manager
  con rotación (coste por secreto), o autenticación IAM a RDS; cifrado en
  reposo con KMS, `security groups` restrictivos, sin acceso público.
- **Operación:** parches de versión menor/mayor, ventanas de mantenimiento,
  backups automáticos y snapshots (coste de almacenamiento), restauración a un
  punto en el tiempo crea una **instancia nueva**, y hay que decidir
  protección contra borrado y snapshot final al destruir.
- **CI efímero:** una PR tendría que crear VPC/subredes/instancia, ejecutar
  migraciones y destruir. Crear una instancia RDS suele tardar varios minutos y
  eliminarla con snapshot final añade tiempo y coste; hay que **probarlo**
  antes de autorizar cualquier recurso persistente (ver sección 5).
- **Reproducibilidad local:** requeriría PostgreSQL en Docker Compose y un
  cliente distinto de `@aws-sdk/lib-dynamodb`; todos los handlers y tests
  actuales de acceso a datos se reescriben.

### Orden de magnitud de coste (a confirmar)

Precios **no verificados** en esta ejecución; deben confirmarse con AWS Pricing
Calculator para la región y fecha antes de decidir. Sólo sirven para comparar
el _tipo_ de coste, no el importe.

| Concepto              | A. DynamoDB on-demand          | C. RDS PostgreSQL                                                      |
| --------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| Base                  | Sin coste fijo                 | Instancia pequeña encendida 24×7 (decenas de USD/mes, más si Multi-AZ) |
| Almacenamiento        | Por GB almacenado              | Volumen aprovisionado mínimo + backups                                 |
| Red                   | Sin VPC                        | NAT o endpoints de interfaz por AZ (decenas de USD/mes)                |
| Conexiones            | No aplica                      | RDS Proxy opcional (coste fijo)                                        |
| Secretos              | No aplica                      | Secrets Manager por secreto                                            |
| Entorno efímero de PR | Ya funciona sin coste inactivo | Instancia + VPC por PR, minutos de aprovisionamiento                   |
| Demo apagada          | ~0                             | Sigue facturando si no se para/destruye                                |

## 4. Evaluación frente a los criterios de la issue

| Criterio                                | A. DynamoDB                          | B. + analítica         | C. RDS                                     |
| --------------------------------------- | ------------------------------------ | ---------------------- | ------------------------------------------ |
| Ajuste a patrones **confirmados**       | Alto                                 | Alto                   | Alto                                       |
| Integridad (FK, unicidad, idempotencia) | Media: por convención y condiciones  | Media                  | Alta                                       |
| Privacidad/borrado demostrable          | Igual (S3/Rekognition fuera)         | Peor (segundo almacén) | Algo mejor en DB; igual entre sistemas     |
| Evolución de consultas                  | Media: rediseño de claves + backfill | Media                  | Alta                                       |
| Rendimiento/escala del MVP              | Suficiente; sin límites relevantes   | Suficiente             | Suficiente; limita por conexiones          |
| Coste total y ciclo de vida             | Mínimo y sin fijo                    | Bajo                   | Alto y fijo                                |
| Seguridad/operación                     | Simple (IAM)                         | Media                  | Compleja (VPC, secretos, parches, backups) |
| Reproducibilidad local/CI               | Ya resuelta (Floci + efímero)        | Media                  | Pendiente de demostrar                     |
| Compatibilidad con ADR-002 / AGENTS.md  | Sí                                   | Sí                     | **No** sin decisión explícita              |

## 5. Prototipos y benchmarks

**No se han ejecutado y no se justifican en este momento.** La issue los pide
sólo si la matriz deja incertidumbre material. La matriz muestra que los
patrones confirmados se resuelven por clave en DynamoDB y que el único caso no
natural (informes) carece de requisito confirmado, por lo que un benchmark
compararía una consulta hipotética.

Se justificarían si se cumple alguna condición: (1) se confirma un requisito
de informes o filtros ad hoc; (2) el consentimiento auditable exige consultas
transversales que DynamoDB no soporta sin proyecciones complejas; o (3) el
volumen deja de ser el del MVP. Entonces, con datos sintéticos, comparar una
operación representativa (alta + matching + galería + borrado) y una consulta
transversal real, midiendo latencia, coste estimado, concurrencia,
idempotencia y recuperación, y **demostrar antes** la factibilidad de CI
efímero para RDS (aprovisionar, migrar, probar y destruir dentro de límites de
tiempo y coste).

## 6. Recomendación (pendiente de aprobación)

**Mantener la opción A (DynamoDB single-table) y no adoptar RDS ni una
proyección analítica ahora.** Criterios y trade-offs:

1. Los patrones confirmados son finitos y por clave; los gaps detectados son de
   implementación (emisión de token, creación de inscripción, `SelfieIndexer`,
   filtro público de eventos), no una consulta que DynamoDB no pueda servir.
2. RDS introduce VPC, red de salida, secretos, conexiones y coste fijo, en
   contra de ADR-002, y su ventaja principal (FK/cascada) no elimina el flujo
   multisistema S3 + Rekognition del derecho al olvido.
3. La única ventaja diferencial de C (informes y consentimiento consultable) no
   tiene hoy un requisito confirmado.

Riesgos de A que la persona responsable debe aceptar o corregir (siguen sin
ser cambios autorizados por esta issue):

- Sustituir el `Scan` del purgador (por ejemplo, con `ttl` en `EVENT#` o un
  índice de caducidad) y completar el borrado de las filas del evento.
- Definir el modelo de consentimiento versionado/revocable antes de
  implementarlo (ítems `CONSENT#` o log) y decidir si se separa persona de
  asistencia.
- Decidir el filtro de `GET /events` (`status=OPEN`), la emisión del token de
  galería y la clave de `GET /registrations/{id}/status`.
- Revisar la partición única de GSI2 si el número de eventos crece.

**Disparadores para reabrir la decisión:** requisito confirmado de informes o
consultas relacionales transversales; consentimiento auditable que exija joins;
volumen que supere las hipótesis del MVP; o cambio explícito de la política de
coste fijo.

## 7. Estado del checklist de cierre de #49

| Criterio                                                                                               | Estado                                                   |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Matriz de acceso y consistencia cubre el alcance y separa hechos de hipótesis                          | Hecho (secciones 1–2; volúmenes marcados como hipótesis) |
| Estado actual trazado a contratos, handlers, tests y Terraform; gaps no presentados como implementados | Hecho (sección 1)                                        |
| Cada alternativa con costes, seguridad, red, secretos, migración/evolución y validación                | Hecho (sección 3); importes de coste **no verificados**  |
| Prototipos/benchmarks si hay incertidumbre material                                                    | No aplica: no hay incertidumbre material (sección 5)     |
| Recomendación con criterios y trade-offs sin alterar la implementación                                 | Hecho (sección 6)                                        |
| La persona responsable aprueba una opción explícitamente                                               | **Pendiente**                                            |
| ADR y issues de implementación/migración/verificación tras la aprobación                               | **Pendiente** (no se publica ADR hasta la aprobación)    |
