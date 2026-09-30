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

El documento es una **propuesta**: no se aplica a AWS sin comparar primero las
políticas vigentes del rol, revisar duplicados y recibir aprobación específica
para PR #72. Después se repetirá el check requerido y se comprobará tanto el
smoke desplegado como el `destroy`. Ningún resultado local o Floci sustituye esa
evidencia.

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
