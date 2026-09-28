# #70: permisos y aceptación AWS pendientes

## Estado

Código preparado; no se ha aplicado AWS ni ampliado ningún rol. La sesión local
caducó. Un PR draft conserva la revisión del diff y ejecuta CI ordinaria; el
workflow efímero sólo hace apply cuando el PR deja de ser draft. Esa transición
se realizará después de revisar este alcance con la persona responsable.

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
