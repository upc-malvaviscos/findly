# Política permanente del rol CI efímero

El rol `findly-github-ephemeral-pr-ci` conserva su trust OIDC para pull requests
internos. Los permisos adicionales que habían sido aprobados y aplicados por
número de PR se consolidan en
[`infra/iam/ephemeral-pr-extensions.json`](../../infra/iam/ephemeral-pr-extensions.json)
para los recursos `findly-pr-*` de `eu-west-1`. Esta política no incluye el
bucket externo de estado de Terraform, `demo` ni `production`.

El documento se derivó de la política con la que la
[PR 82](https://github.com/upc-malvaviscos/findly/actions/runs/36983910038)
completó su check AWS. Se eliminaron los números fijos de PR y se conservaron las restricciones
por ARN, región y etiquetas. En `rekognition:CreateCollection` y
`lambda:CreateEventSourceMapping`, AWS exige `Resource: "*"`; las condiciones
de región y etiquetas restringen esas creaciones a datos sintéticos del
entorno efímero. La política no concede acciones de IAM para editarse a sí
misma o modificar el trust OIDC.
El conjunto de 59 acciones coincide con el documento aprobado para PR 82; el
cambio de alcance está en los recursos y condiciones que admiten cualquier
número de PR efímera.

El 2 de octubre de 2026 se creó la versión `v1` de la política administrada
`findly-ephemeral-pr-extensions` y se asoció al rol CI. Access Analyzer devolvió
cero findings; el documento de la versión aplicada coincide con el archivo
versionado. El simulador IAM del rol autorizó para recursos de PR 83 las
cinco acciones que habían fallado en el aprovisionamiento: SQS `CreateQueue`,
SNS `CreateTopic`, Logs `PutMetricFilter`, Scheduler `CreateSchedule` y Lambda
`PutFunctionEventInvokeConfig`. También autorizó `CreateCollection` y
`CreateEventSourceMapping` con etiquetas sintéticas de PR 83. Denegó una cola
`findly-demo-*` y una colección sin `Ephemeral=true`.

La simulación no demuestra por sí sola que todas las APIs autoricen el
recorrido. La evidencia desplegada y el estado de teardown se registrarán tras
la primera PR ejecutada con la política permanente. Las políticas antiguas por
número de PR permanecerán hasta completar esa migración sin interrumpir
ejecuciones activas.
