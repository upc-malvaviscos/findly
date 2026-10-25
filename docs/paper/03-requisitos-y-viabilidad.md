# 3. Requisitos y viabilidad

## Requisitos funcionales

- Un asistente acepta el consentimiento biométrico y carga una selfie mediante
  una URL S3 prefirmada de una sola escritura (`If-None-Match: *`, ADR-014);
  una Lambda indexa el rostro en Amazon Rekognition y expone el estado de
  inscripción (`UPLOAD_PENDING → PROCESSING → ENROLLED|FAILED`) por sondeo.
- Un organizador autenticado con Cognito crea eventos y carga fotografías; una
  Lambda desacoplada por SQS busca coincidencias faciales con un umbral de
  similitud del 95,0 % o más.
- El asistente recibe una galería privada con URLs S3 prefirmadas de corta
  duración y puede solicitar la retirada de sus datos (derecho al olvido), que
  borra el registro, las coincidencias, el token, la selfie y el `FaceId`
  indexado.
- Los eventos y sus datos derivados caducan según una política de retención
  configurable por evento (mínimo de demostración: siete días).

## Requisitos no funcionales

La [matriz de métricas de éxito](../../specs/00-scope-adr-and-success-metrics.md)
fija los umbrales cuantitativos y su fuente de telemetría:

| Métrica                         | Fuente                   | Umbral objetivo                                        |
| ------------------------------- | ------------------------ | ------------------------------------------------------ |
| Inscripción completa            | CloudWatch / DynamoDB    | > 98 % de solicitudes completadas                      |
| Umbral de similitud             | Rekognition / DynamoDB   | Similitud >= 95,0 %                                    |
| Procesamiento de selfie         | CloudWatch Metrics       | < 3 s desde `S3 PUT` hasta `ENROLLED`                  |
| Respuesta de galería            | CloudFront / API Gateway | p95 < 500 ms                                           |
| Control de presupuesto (FinOps) | AWS Budgets              | 100 % dentro de $0 (capa gratuita/sandbox) o $5 (demo) |
| Borrado GDPR                    | Lambda Audit Logs        | 100 % de los datos purgados tras caducidad o solicitud |

Son objetivos, no seis resultados acreditados. Los ensayos AWS sí verifican
matching, galería y borrado en escenarios concretos; la aceptación histórica de
\#87 verificó `ENROLLED`, pero su cronómetro no aísla S3 PUT → `ENROLLED`;
no permite confirmar ni refutar el objetivo < 3 s. No hay
una campaña de carga que acredite p95 < 500 ms ni una tasa agregada de
inscripción superior al 98 %, una medición de precisión estadística o una
factura completa. El umbral de similitud del 95 % no equivale a una precisión
del 95 %. El capítulo 8 distingue cada resultado y su alcance.

## Análisis de FaceLocator (matching facial)

La spec 07 documenta una corrección de implementación relevante para la
viabilidad: `SearchFacesByImageCommand` sólo detecta el rostro más prominente de
la imagen de entrada, comportamiento documentado de Rekognition y no una opción
de configuración. Para fotos de evento con varias personas — el caso normal —
esa llamada dejaría sin intentar el resto de rostros. La implementación usa en
su lugar `IndexFacesCommand` (detecta e indexa temporalmente cada rostro de la
foto) → `SearchFacesCommand` por `FaceId` para cada rostro detectado →
`DeleteFacesCommand` de limpieza, a costa de 3 tipos de llamadas: una indexación
por foto, una búsqueda por rostro y la limpieza de los identificadores
temporales, además de posibles reintentos.
`docs/evidence/issue-08-photo-matching.md` registra la validación unitaria de
este patrón; la ejecución con Rekognition real está verificada dentro del run de
aceptación de PR #71 (capítulo 8).

Las colecciones de Rekognition se aíslan por entorno y evento
(`${project}-${environment}-event-*`, ADR-015): un fallo de aislamiento
permitiría que un handler de un entorno consultara o borrara caras de otro.
La compatibilidad con colecciones creadas antes de ADR-015 (`findly-event-*`,
sin sufijo de entorno) exige una migración explícita que no se ha ejecutado
ni se ha planificado con fecha.

## Alternativas de persistencia y decisión confirmada

La revisión histórica de #49 comparó DynamoDB y PostgreSQL/RDS. La decisión
vigente está tomada y la issue está cerrada: ADR-022 (2026-10-12) confirma
DynamoDB on-demand para el backlog, sin RDS ni VPC dedicada. #87 implementa
matching en ambos órdenes mediante backfill post-`ENROLLED`; #89 usa un ítem
espejo por foto para consultar y borrar sus matches sin `Scan`.

El benchmark AWS de la PR #141 encontró dos fallos operativos. Las PR #143/#144
corrigieron el timeout/borrado por lotes y añadieron la condición de existencia
de foto a `writeMatch`; la aceptación combinada registró `204` en 2.020 ms con
100 matches y 3.082 ms con 1.000, sin huérfanos en los escenarios ejercitados.
ADR-024 añadió posteriormente el tombstone `deletedAt`: la condición de
existencia histórica no comprobaba esa marca. #166 persiste el marcador antes
de consultar espejos y revalida tombstone/TTL atómicamente. #168 integra esa
corrección y supera el smoke AWS efímero con teardown; las carreras/TTL
específicos en AWS y la publicación permanente siguen pendientes. No se generaliza el ensayo
anterior a todas las carreras actuales.

Ningún motor incluye S3, Rekognition o SES en su transacción. La publicación a
SQS posterior a una escritura DynamoDB sigue sin ser atómica: Outbox es trabajo
futuro, no una capacidad implementada (capítulo 9). Las decisiones y límites
constan en ADR-022/023/024 y en la evidencia de #49 y #89.

## Viabilidad de coste

El entorno efímero de pull request (ADR-008) y el entorno local con Floci cubren
el desarrollo y la integración sin capacidad de cómputo dedicada; los recursos
AWS retenidos pueden seguir generando consumo. El bootstrap de un backend
Terraform persistente para `sandbox`/`demo`/`production` (ADR-009) falló primero
en un AWS Learner Lab, que deniega `s3:CreateBucket` en `eu-west-1` y bloquea
`GetBucketObjectLockConfiguration` por política de cuenta. Después se verificó
en una cuenta AWS dedicada (issue #61): el bucket de estado se aplicó en
`eu-west-1` con versionado, SSE-S3, bloqueo público y política TLS-only, y la
migración de un estado sandbox previo con `moved` dio `0 to destroy`
(`docs/evidence/issue-11-terraform-remote-state.md`). Los recursos de sandbox de
esa prueba se destruyeron al terminar. La viabilidad económica del MVP (coste
$0 en capa gratuita/sandbox,
$5 en demo) está demostrada en el diseño y en un
`terraform plan` sin conexión a AWS
(`docs/evidence/issue-13-observability-finops.md`), no en una factura o un
presupuesto real activado.
