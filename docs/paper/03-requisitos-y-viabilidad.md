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

## Alternativas de persistencia y motivo para no usar RDS

ADR-002 fija DynamoDB on-demand, sin RDS, EC2, NAT ni VPC dedicada, para
eliminar coste fijo. La issue #49 abrió un análisis formal de esa decisión
frente a PostgreSQL/RDS para el modelo completo (no sólo el MVP); su resultado
completo está en `docs/evidence/issue-49-dynamodb-vs-rds-analysis.md`. Resumen
verificado contra el código en `main`:

- Los patrones de acceso confirmados (evento, inscripción, token, coincidencias
  por registro, `FaceId`) son finitos y se resuelven por clave o por GSI; los
  huecos detectados (emisión de token, filtro de eventos públicos por estado,
  consentimiento versionado) son de implementación, no una consulta que
  DynamoDB no pueda servir.
- RDS exigiría VPC con al menos dos zonas de disponibilidad y, para que una
  Lambda en esa VPC alcance Rekognition, SQS, Secrets Manager o CloudWatch
  Logs, un NAT Gateway o puntos de enlace de interfaz con coste fijo por hora
  y AZ — incompatible con ADR-002 y con AGENTS.md.
- Ninguna de las dos alternativas resuelve de forma atómica el derecho al
  olvido: S3 y Rekognition quedan siempre fuera de la transacción de base de
  datos, sea DynamoDB o PostgreSQL.
- La única ventaja diferencial de RDS (informes y consultas relacionales
  transversales) no tiene hoy un requisito confirmado en ninguna spec.

**Esta decisión sigue abierta**: el análisis recomienda mantener DynamoDB,
pero la aprobación explícita de la persona responsable y un ADR que confirme o
sustituya ADR-002 están pendientes (issue #49). Esta memoria no presenta esa
recomendación como una decisión tomada.

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
