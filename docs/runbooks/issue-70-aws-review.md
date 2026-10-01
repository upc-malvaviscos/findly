# #70: revisión de permisos y aceptación AWS

## Resultado final de la PR #71 (2026-09-28)

La PR #71 se fusionó tras el
[run AWS 36482560393](https://github.com/upc-malvaviscos/findly/actions/runs/36482560393).
El stack efímero acreditó inscripción, matching, firma/CORS, galería,
borrado, purga manual, redrive y alarma SNS → SQS. El destroy eliminó
103 recursos y el estado remoto PR71 quedó vacío. La cronología de permisos
y recuperación que sigue documenta los intentos previos a esa aceptación.
El cron real, Budgets/correo y la SPA demo publicada siguen pendientes.

## Estado

En un intento anterior, la PR #71 estaba ready y activó provisión AWS. La ejecución 36464575720
falló por permisos del rol externo. La persona responsable aprobó la política
`findly-pr-71-approved-provisioning`, aplicada sin modificar las políticas
previas; su JSON reproducible está en `docs/evidence/issue-70-ci-permissions-proposal.json`.
La repetición encontró denegaciones adicionales y el teardown quedó bloqueado
por lectura de suscripción SNS. Se inició recuperación desde el mismo estado
remoto de PR #71. En ese momento, la aceptación desplegada seguía pendiente.

La ampliación adicional `findly-pr-71-approved-followup` fue aprobada y aplicada;
su documento es `docs/evidence/issue-70-ci-permissions-followup.json`.
También se aprobó el alcance completo de los runners en
`docs/evidence/issue-70-ci-acceptance-permissions.json`. Se adjuntó exclusivamente
al rol CI como política administrada `findly-pr-71-approved-acceptance` porque
AWS rechazó añadirla inline al superar el límite agregado de 10240 bytes.
El documento y alcance son idénticos a los aprobados. La creación del enlace
SQS/Lambda exige Resource `*` porque AWS no permite limitar esa acción por
ARN de mapping; se restringe por FunctionArn, región y etiquetas de PR.
Referencia: [autorización Lambda](https://docs.aws.amazon.com/service-authorization/latest/reference/list_lambda.html).

## Rol efímero

Mantener trust exacto `repo:upc-malvaviscos/findly:pull_request`, cuenta/región y
prefijos `findly-pr-*`. Antes de añadir permisos, leer la política vigente y
comparar acciones; esta lista describe necesidades, no autorizaciones globales.

| Uso                          | Acciones necesarias                                                                                                                                                                                 | Recursos                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Colecciones sintéticas       | rekognition:ListFaces, DeleteCollection                                                                                                                                                             | sólo colecciones de eventos sintéticos creados por el run; comparar tags Project/Environment         |
| Métricas de error            | logs:PutMetricFilter, DeleteMetricFilter, DescribeMetricFilters                                                                                                                                     | grupos /aws/lambda/findly-pr-_-public-_                                                              |
| Cola y DLQ                   | sqs:CreateQueue, GetQueueAttributes, SetQueueAttributes, DeleteQueue, TagQueue, UntagQueue, ListQueueTags, GetQueueUrl                                                                              | ARN de colas findly-pr-* en cuenta y eu-west-1                                                       |
| Pruebas redrive/alerta       | sqs:SendMessage, ReceiveMessage, DeleteMessage, ChangeMessageVisibility                                                                                                                             | cola/DLQ/suscriptor del PR probado                                                                   |
| Topic y suscriptor de prueba | sns:CreateTopic, GetTopicAttributes, SetTopicAttributes, DeleteTopic, TagResource, UntagResource, ListTagsForResource, Subscribe, GetSubscriptionAttributes, SetSubscriptionAttributes, Unsubscribe | topic findly-pr-*-alerts y suscripciones de ese topic                                                |
| Scheduler                    | scheduler:CreateSchedule, GetSchedule, UpdateSchedule, DeleteSchedule                                                                                                                               | schedule/default/findly-pr-*-retention-purger                                                        |
| Pasar rol Scheduler          | iam:PassRole                                                                                                                                                                                        | findly-pr-*-retention-purger-scheduler-role, iam:PassedToService=scheduler.amazonaws.com             |
| Probe de Scheduler/TTL       | dynamodb:DescribeTimeToLive; rekognition:CreateCollection, DescribeCollection, DeleteCollection                                                                                                     | tabla y colecciones sintéticas del PR probado, en eu-west-1                                          |
| Pruebas purga/indexación     | lambda:InvokeFunction                                                                                                                                                                               | sólo funciones findly-pr-* de ese PR                                                                 |
| Datos sintéticos             | dynamodb:PutItem, GetItem, Query, DeleteItem                                                                                                                                                        | tabla findly-pr-*, índice GSI2 correspondiente                                                       |
| Comprobar datos/firmas       | s3:PutObject, GetObject, DeleteObject; s3:ListBucket                                                                                                                                                | bucket findly-pr-_, objetos events/_; ListBucket con prefijo events/*                                |
| Comprobar logs y alarma      | logs:DescribeLogGroups, FilterLogEvents; cloudwatch:DescribeAlarms                                                                                                                                  | grupos /aws/lambda/findly-pr-* y alarma DLQ del PR; DescribeLogGroups puede requerir scope de cuenta |
| Crear/destruir alarmas       | cloudwatch:PutMetricAlarm, DeleteAlarms, TagResource, UntagResource, ListTagsForResource                                                                                                            | alarma findly-pr-*                                                                                   |

No se concede Budgets al rol efímero: `enable_budget=false`. Los permisos
Terraform existentes para S3, IAM, Lambda/API/Cognito/DynamoDB se conservan y se
verifica cada nuevo ARN/acción requerido, sin comodines de acción globales.
Las políticas de ejecución Lambda nuevas están en sus módulos y usan ARNs
de tabla/bucket del entorno y colecciones de evento, no credenciales nuevas.

La continuación aprobada añade ListFaces a los roles de limpieza/indexación
para reconciliar rostros creados antes de persistir su referencia. Se limita
a colecciones `${project}-${environment}-event-*`. Los localizadores RETENTION
comparten la tabla del entorno; no requieren Scan, índice nuevo ni otro
servicio. Esto describe los roles de ejecución propuestos por Terraform,
no una ampliación aplicada al rol CI externo.

La configuración de reintentos asíncronos de SelfieIndexer fija seis horas
y dos reintentos de error. Terraform requiere GetFunctionEventInvokeConfig,
PutFunctionEventInvokeConfig y DeleteFunctionEventInvokeConfig únicamente
para la función del PR. Estas acciones fueron aprobadas y aplicadas mediante
findly-pr-71-approved-provisioning; el JSON reproducible enlazado arriba
conserva ese alcance.

Las tres decisiones de modelo/contrato/aislamiento están aprobadas y registradas
en ADR-013, ADR-014 y ADR-015. La revisión del rol externo y el plan contra
estado real precedieron los applies efímeros ejecutados. La compatibilidad
de colecciones legacy exige una migración explícita independiente.
No añadir permisos de borrado global `findly-event-*` para ocultar esa migración.

## Despliegue persistente

`deploy.yml` conserva la estructura de la rama previa de #15, pero usa roles
externos revisados por entorno y outputs de Terraform. No incorpora la antigua
política de permisos amplios de esa rama. Variables GitHub por environment:

- AWS_DEPLOY_ROLE_ARN y AWS_TERRAFORM_STATE_BUCKET.
- FINDLY_UPLOADS_BUCKET_NAME y FINDLY_WEB_BUCKET_NAME.
- FINDLY_WEB_DOMAIN_NAME y FINDLY_WEB_CERTIFICATE_ARN (ACM us-east-1).

Ejecutar primero workflow_dispatch con apply=false. Revisar el plan y el
estado previo de #61; el guard rechaza reemplazos/destrucciones y recursos con
coste fijo. apply=true es una acción separada, protegida por el environment.
El workflow no genera un dominio, certificado ni políticas IAM implícitos.
Los buckets demo/production siguen sin force_destroy.

## Cierre

La aceptación efímera no acredita una SPA demo publicada ni el cron real. El
smoke invoca RetentionPurger manualmente. SNS→SQS prueba entrega automática de
la alarma; no correo confirmado ni el disparo de Budgets. Nunca generar gasto
para forzar un umbral. #13/#18/#61 siguen abiertas hasta su evidencia propia.

## Upgrade aprobado de proveedor

La persona responsable aprobó AWS provider 6.x para Lambda Node 24. Los cinco
lockfiles seleccionan 6.66.0. Todos los módulos Lambda se alinean con el
target Node 24 del empaquetado. No se migra ninguna tabla ni índice: hash_key
y range_key mantienen el esquema existente. validate advierte deprecación;
el esquema local del proveedor todavía no expone key_schema. Se conserva la
configuración y se exige plan real sin destrucciones antes del apply.

## Consulta de mapping eliminado

La persona responsable aprobó la excepción de solo lectura
`lambda:GetEventSourceMapping` con Resource `*` y región eu-west-1, necesaria
para que el waiter Terraform confirme ausencia tras DeleteEventSourceMapping.
Se aplicó `findly-pr-71-approved-mapping-read`; el JSON de evidencia está en
`docs/evidence/issue-70-ci-mapping-read-proposal.json`. Los permisos de creación,
modificación y borrado del mapping conservan las restricciones de PR #71.
