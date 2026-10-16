# ADR-022: Confirmación de DynamoDB y contratos de acceso para #87/#89

## Estado y alcance

Aceptado por la persona responsable el 2026-10-12 para la issue #49, en el
contexto de #87 y #89. **#49 sigue abierta**: este ADR fija el motor de
persistencia y los dos contratos de acceso pendientes, pero no sustituye el
benchmark sintético de convergencia/fan-out de #87 (sección 7 del
[análisis de evidencia](../evidence/issue-49-dynamodb-vs-rds-analysis.md)).
La issue #49 se cierra únicamente cuando ese benchmark exista y esté
documentado. No autoriza implementar #87/#89, migrar datos, aplicar Terraform
ni ejecutar AWS nuevo. ADR-002 queda confirmado, no sustituido.

## Decisión: DynamoDB para todo el backlog abierto

Se mantiene DynamoDB Single-Table (spec 02) como motor de persistencia para
las issues #86, #87, #88, #89, #98, #105, #107 y el resto del backlog abierto
inventariado en la issue #49. No se migra a PostgreSQL/RDS.

La justificación técnica es independiente de cualquier política del proyecto:

1. **Patrón de acceso.** Las consultas confirmadas en el inventario de la
   issue #49 (sección 2–4) son casi todas por clave conocida — evento,
   registro, foto, token — con una única relación muchos-a-muchos real
   (foto→matches, #89). No hay JOINs ad hoc ni informes transversales
   confirmados en el backlog. Ese es exactamente el caso de uso para el que
   DynamoDB Single-Table está diseñado; un motor relacional no aporta ventaja
   cuando el acceso no exige consultas arbitrarias entre entidades.
2. **Concurrencia bajo Lambda.** Cada subida de selfie o foto dispara
   handlers Lambda concurrentes y en rachas (`selfieIndexer.ts`,
   `photoMatcher.ts`). DynamoDB escala ese patrón horizontalmente sin estado
   de conexión. RDS tiene un límite fijo de conexiones por instancia y
   necesitaría RDS Proxy (coste y pieza operativa adicionales) para no
   agotar el pool bajo esos picos — un problema conocido de Lambda sobre RDS
   en cargas serverless, no una limitación hipotética.
3. **Modelo de coste alineado al patrón de uso real.** La demo no corre de
   forma continua. DynamoDB on-demand cobra por petición/almacenamiento y
   escala a cero entre usos; RDS cobra por tiempo de instancia
   independientemente del tráfico, por lo que mantenerla barata exige
   parar/arrancarla manualmente (operación adicional que DynamoDB no
   necesita).
4. **Coste de modelado relacional ya acotado.** La única relación
   muchos-a-muchos confirmada (#89) se resuelve con un ítem espejo de bajo
   coste de escritura (sección siguiente), no con un esquema relacional
   completo. No hay necesidad confirmada de JOINs arbitrarios que justifique
   cambiar de motor para resolver un único patrón de acceso.

Esta conclusión técnica coincide, de forma independiente, con la política que
excluye RDS/EC2/NAT/VPC por su coste fijo — pero no depende de
ella: incluso sin esa restricción, el patrón de acceso y la concurrencia de
Findly favorecen DynamoDB sobre RDS para este backlog. Por eso no se ejecuta
el ciclo efímero de RDS que proponía la sección 7 del análisis de evidencia
("ciclo efímero del candidato RDS"): mediría una diferencia de coste y
conexión que el diseño de ambos motores ya hace predecible, sin que un
benchmark real pudiera invalidarla con esta forma de carga.

Esto no resuelve por sí solo la incertidumbre de fan-out/convergencia que la
issue #87 introduce sobre el modelo actual: esa incertidumbre es sobre el
**diseño** dentro de DynamoDB, no sobre la elección DynamoDB-vs-RDS, y se
resuelve con el contrato de la siguiente sección más el benchmark pendiente.

## Contrato de acceso inverso foto→match (#89)

Se añade un ítem espejo por cada match, escrito en la misma transacción que el
match original:

- `PK = PHOTO#{eventId}#{photoId}`, `SK = MATCH#{registrationId}`.
- Mismos atributos que el match (`similarity`, `matchedAt`, `ttl`); sin
  duplicar datos sensibles adicionales.
- `writeMatch` (hoy en `photoMatcher.ts`) añade este `Put` al mismo
  `TransactWriteCommand` que ya escribe `REG#id/MATCH#photoId`; ambos items se
  crean o ninguno, preservando la idempotencia existente
  (`ConditionExpression: 'attribute_not_exists(PK)'`).
- El borrado de foto (#89) consulta `PK = PHOTO#{eventId}#{photoId}` para
  encontrar todos los `REG` afectados sin Scan, y borra ambos items del match
  en la misma operación de limpieza.
- Matches existentes antes de este ADR requieren backfill idempotente del
  ítem espejo antes de que #89 dependa de esa consulta; no se considera parte
  de este ADR, sino de la implementación de #89.

Se elige el ítem espejo sobre un GSI porque #89 necesita lectura fuerte para
confirmar limpieza completa antes de responder al administrador; un GSI
(consistencia eventual) obligaría a reconciliar tras el retraso del índice en
cada borrado, lo que la propia issue #89 señala como riesgo de huérfanos.

## Contrato de backfill tras ENROLLED (#87)

Cuando una inscripción transiciona a `ENROLLED` con `faceId` persistido
(`selfieIndexer.ts`), se encola un trabajo de backfill paginado sobre
`PK = EVENT#{eventId}, SK begins_with PHOTO#` para esa inscripción. Por cada
foto ya existente, el trabajo reaplica el mismo núcleo de matching que usa hoy
`photoMatcher.ts` ante una foto nueva: indexar temporalmente la cara de la
foto, `SearchFaces` contra la colección del evento (que ya incluye la cara
recién indexada de esta inscripción), resolver el registro vía GSI1 si aplica,
escribir el match (con su ítem espejo) y borrar la cara temporal indexada.

La convergencia entre este trigger y el trigger S3 normal (foto subida después
de ENROLLED) no requiere coordinación adicional: ambos caminos terminan en la
misma escritura condicional `attribute_not_exists(PK)` sobre la clave del
match. Un doble disparo sobre la misma foto no duplica el match; solo gasta
una llamada Rekognition adicional, aceptable bajo la optimización de costes de
spec 21. La paginación del backfill debe continuar de forma durable (mismo
patrón de cursor que `galleryEmail.ts`/`retentionPurger.ts`) para no truncar
eventos con muchas fotos; el diseño del cursor concreto, su cola y sus
reintentos quedan para la implementación de #87, no para este ADR.

## Adenda (2026-10-16): `writeMatch` condiciona la escritura a que la foto exista

El benchmark de fan-out de #49 (sección 7 del análisis de evidencia) confirmó
contra AWS real una carrera que este ADR no había cubierto: `matchPhoto` es
asíncrono (Rekognition `IndexFaces`/`SearchFaces` tras un evento S3, o el
backfill de #87) y puede terminar de resolver un match _después_ de que la
foto que lo originó ya no exista — borrada por `deleteEventPhoto` (#89) o
expirada por su propio `ttl` (`PhotoEntity.ttl`). `writeMatch`
(`src/lambdas/lib/matching.ts`) solo condicionaba la escritura al estado de la
inscripción (`ENROLLED`, `faceId`, `ttl`, sin `erasureRequestedAt`); nunca a
la existencia de la foto. El resultado observado: un match y su ítem espejo
huérfanos de una foto ya borrada, con el borrado ya confirmado `204` al
administrador.

Se añade un cuarto `ConditionCheck` a la misma `TransactWriteCommand` que ya
escribe el match y su espejo, sobre `photoKey(eventId, photoId)` con
`attribute_exists(PK)`. Un fallo de esta condición cae en el mismo camino que
ya existía para "inscripción ya no elegible": `writeMatch` captura
`TransactionCanceledException` por `ConditionalCheckFailed` en cualquier ítem
de la transacción y descarta el match en silencio, sin lógica nueva de
error. La condición cubre ambas causas de ausencia (borrado explícito y
expiración por `ttl`), no solo el caso que #89 dispara.

No introduce una barrera temporal (como ADR-013 para inscripciones) ni un
paso de reconciliación posterior: esta condición evita la escritura huérfana
en origen, dentro de la misma transacción atómica que ya existía, sin coste
de llamadas AWS adicionales ni cambio de contrato público. Verificado por
unitarias (`tests/lambdas/photoMatcher.test.ts`,
`tests/lambdas/registrationBackfillMatching.test.ts`); la repetición del
escenario de carrera del benchmark de #49 contra AWS real queda pendiente
(ver `docs/evidence/issue-89-admin-event-photo-lifecycle.md`).

## Qué no decide este ADR

- No implementa #87 ni #89; fija su contrato de acceso para que su
  implementación no tenga que repetir esta decisión.
- No cierra #49: el benchmark sintético de convergencia/fan-out (sección 7 del
  análisis de evidencia) sigue pendiente de ejecutarse y documentarse antes de
  cerrar esa issue.
- No autoriza AWS nuevo, Terraform ni cambios de IAM.
- No afecta a #98/SES ni a la decisión de #86, que ya usa DynamoDB bajo
  ADR-019.
