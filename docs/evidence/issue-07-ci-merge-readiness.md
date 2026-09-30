# PR #72: preparación del check AWS efímero

## Estado observado

El commit `bdb5111` de la PR #72 tenía ocho checks correctos y fallaba el check
obligatorio `provision-test-destroy` en el paso de aprovisionamiento. El rol OIDC
`findly-github-ephemeral-pr-ci` recibió denegaciones para `sns:CreateTopic`,
`logs:PutMetricFilter`, `scheduler:CreateSchedule` y
`lambda:PutFunctionEventInvokeConfig`. Terraform terminó con código 1; los
pasos de verificación desplegada no se ejecutaron. El teardown sí destruyó los
84 recursos creados parcialmente.

## Propuesta de permisos para PR #72

`issue-07-ci-permissions-proposal.json` adapta a recursos `findly-pr-72-*` las
cuatro políticas autorizadas previamente para la PR #71. Incluye el ciclo de
vida de Terraform y las comprobaciones desplegadas, no sólo las cuatro acciones
denegadas al inicio. Conserva el trust OIDC existente y no añade credenciales.
La excepción de lectura `lambda:GetEventSourceMapping` usa `Resource = "*"`
limitado a `eu-west-1`, conforme al waiter de Terraform documentado para #71.

La propuesta se validó con IAM Access Analyzer, se comparó con las políticas
vigentes del rol y se aplicó tras la aprobación específica para PR #72. La
política `findly-pr-72-approved-merge-readiness` quedó adjunta al rol OIDC en
la cuenta `567158658992`; el documento AWS coincide con este JSON. La repetición
del check aprovisionó el entorno y ejecutó el primer recorrido desplegado. La
aceptación adicional de la issue #70 falló en el matching de una foto sintética:
Rekognition devolvió `InvalidParameterException`. El `destroy` eliminó los 103
recursos. El matcher ahora registra sólo el nombre de la operación fallida y la
clase del error para precisar el diagnóstico en la siguiente ejecución; no
registra imágenes, FaceIds ni mensajes libres. La PR sigue pendiente del smoke
completo y de un nuevo `destroy` correcto.

## Sincronización

La rama se actualiza sobre `main` conservando el diff neto de la PR: las
pruebas de integración Floci y su documentación. La issue #7 seguirá abierta
hasta que sus criterios tengan evidencia y se sincronicen sus casillas.

En macOS, la primera ejecución de `npm run test:floci:integration` reprodujo
14 fallos `CredentialsProviderError`: el proceso heredaba `AWS_PROFILE` y el
SDK intentaba usar SSO en vez de las credenciales sintéticas de Floci. Ejecutar
la misma suite sin ese perfil dio 14/14 correctas. El runner ahora elimina
`AWS_PROFILE` y `AWS_DEFAULT_PROFILE` sólo del subproceso Vitest; una repetición
con el perfil habitual dio 14/14 correctas. `npm run harness:check`,
`npm run harness:check:e2e`, `npm run verify` y `npm run lint` pasaron.
`verify` incluyó 294 pruebas unitarias y auditoría de dependencias de
producción sin vulnerabilidades. TFLint requirió ejecución fuera del sandbox
local para iniciar su plugin; no se omitió del gate.
