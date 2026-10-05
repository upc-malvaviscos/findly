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
| Precisión de coincidencia       | Rekognition / DynamoDB   | Similitud >= 95,0 %                                    |
| Procesamiento de selfie         | CloudWatch Metrics       | < 3 s desde `S3 PUT` hasta `ENROLLED`                  |
| Respuesta de galería            | CloudFront / API Gateway | p95 < 500 ms                                           |
| Control de presupuesto (FinOps) | AWS Budgets              | 100 % dentro de $0 (capa gratuita/sandbox) o $5 (demo) |
| Borrado GDPR                    | Lambda Audit Logs        | 100 % de los datos purgados tras caducidad o solicitud |

Ninguna de estas seis métricas se ha medido todavía contra tráfico real: la
telemetría de CloudWatch existe (`docs/evidence/issue-13-observability-finops.md`),
pero no se ha ejecutado un recorrido que agregue percentiles ni un volumen que
distinga el 98 % de un caso aislado. El capítulo 8 registra qué se ha
verificado y con qué alcance.

## Análisis de FaceLocator (matching facial)

La spec 07 documenta una corrección de implementación relevante para la
viabilidad: `SearchFacesByImageCommand` sólo detecta el rostro más prominente
de la imagen de entrada, comportamiento documentado de Rekognition y no una
opción de configuración. Para fotos de evento con varias personas — el caso
normal — esa llamada dejaría sin intentar el resto de rostros. La
implementación usa en su lugar `IndexFacesCommand` (detecta e indexa
temporalmente cada rostro de la foto) → `SearchFacesCommand` por `FaceId`
para cada rostro detectado → `DeleteFacesCommand` de limpieza, a costa de 3
llamadas a Rekognition por foto en vez de 1. `docs/evidence/issue-08-photo-matching.md`
registra la validación unitaria de este patrón; la ejecución con Rekognition
real está verificada dentro del run de aceptación de PR #71 (capítulo 8).

Las colecciones de Rekognition se aíslan por entorno y evento
(`${project}-${environment}-event-*`, ADR-015): un fallo de aislamiento
permitiría que un handler de un entorno consultara o borrara caras de otro.
La compatibilidad con colecciones creadas antes de ADR-015 (`findly-event-*`,
sin sufijo de entorno) exige una migración explícita que no se ha ejecutado
ni se ha planificado con fecha.

## Alternativas de persistencia y decisión abierta

ADR-002 mantiene DynamoDB on-demand sin RDS ni VPC dedicada en la implementación
vigente. El [análisis de #49](../evidence/issue-49-dynamodb-vs-rds-analysis.md)
se actualizó el 2026-10-05 contra 12 issues abiertas y el código de su
instantánea. Inscripción, tokens, filtro público, GSI1 y purga están
implementados; los gaps históricos no justifican la recomendación actual.

- #87 requiere matching en ambos órdenes y convergencia simultánea; #89 exige
  consultar todos los matches de una foto y limpiar con barreras durables.
  Sus contratos incompletos introducen incertidumbre material.
- DynamoDB puede ampliarse con trabajo durable y acceso inverso, pero hay que
  comparar índices/referencias, backfill, coste y consistencia de borrado.
- PostgreSQL aporta relaciones, restricciones y consultas inversas indexadas,
  incluso sin informes ad hoc. Su candidato requiere migración, conexiones,
  seguridad de red, backups y prueba de factibilidad en CI. NAT, endpoints y
  proxy dependen del diseño; no se presuponen necesarios.
- Ninguna base incluye S3, Rekognition o SES en su transacción. Los efectos
  externos y los trabajos tardíos requieren recuperación e idempotencia.

**Esta decisión sigue abierta**: mantener el código vigente mientras se decide
no aprueba DynamoDB para todo el backlog. Las pruebas comparables propuestas
no se han ejecutado; falta la decisión explícita y un ADR que confirme o
sustituya ADR-002. No se ha autorizado una migración.

## Viabilidad de coste

El entorno efímero de pull request (ADR-008) y el entorno local con Floci
cubren el desarrollo y la integración continua sin coste fijo. El bootstrap de
un backend Terraform persistente para `sandbox`/`demo`/`production` (ADR-009)
falló primero en un AWS Learner Lab, que deniega `s3:CreateBucket` en
`eu-west-1` y bloquea `GetBucketObjectLockConfiguration` por política de
cuenta. Después se verificó en una cuenta AWS dedicada (issue #61): el bucket
de estado se aplicó en `eu-west-1` con versionado, SSE-S3, bloqueo público y
política TLS-only, y la migración de un estado sandbox previo con `moved` dio
`0 to destroy` (`docs/evidence/issue-11-terraform-remote-state.md`). Los
recursos de sandbox de esa prueba se destruyeron al terminar. La viabilidad económica del MVP (coste $0 en capa gratuita/sandbox,
$5 en demo) está demostrada en el diseño y en un `terraform plan` sin conexión
a AWS (`docs/evidence/issue-13-observability-finops.md`), no en una factura o
un presupuesto real activado.
