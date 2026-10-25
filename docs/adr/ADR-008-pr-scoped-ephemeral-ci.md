# ADR-008: CI efímera por pull request con OIDC y estado remoto aislado

## Contexto

Una limpieza cada doce horas deja una ventana de coste y comparte el riesgo de
destrucción entre entornos. El flujo necesita comprobar en navegador el trabajo
del organizador sin almacenar credenciales AWS.

## Decisión

GitHub Actions se autentica exclusivamente mediante el proveedor AWS OIDC y
credenciales temporales de `AssumeRoleWithWebIdentity`; no se guardan access
keys, tokens AWS ni perfiles en GitHub. Cada PR interno no draft asume el rol
`findly-github-ephemeral-pr-ci`, un backend S3 cifrado y la clave de estado
`ephemeral/pr-<numero>/terraform.tfstate`. Terraform sólo acepta números de PR
y nombra y etiqueta los recursos con `pr-<numero>`. El workflow serializa
ejecuciones del mismo PR y ejecuta `destroy` con `always()`.

La frontera de confianza del rol exige exactamente el audience
`sts.amazonaws.com` y el subject
`repo:upc-malvaviscos/findly:pull_request`. No autoriza ramas, GitHub
environments, otros repositorios ni forks. Floci sigue siendo la dependencia
local de E2E: los handlers reales de eventos y prefirmado se ejercitan contra
DynamoDB y S3 emulados con datos sintéticos.

El check AWS ejecuta Playwright contra los endpoints reales del stack efímero,
sin Floci. Entre `apply` y `destroy`, crea un usuario Cognito temporal y verifica
administración, firmas S3, inscripción pública, polling y galería con datos
sintéticos. Los runners adicionales comprueban borrado, purga, redrive y
observabilidad; su preparación no acredita criterios que todavía no pasan.
El documento vacío de origen puede suministrarse mediante routing Playwright,
pero se retira la interceptación antes de API/S3 para conservar el preflight
nativo de Chromium. La interceptación activa no acredita CORS real.
El job `e2e` mantiene un recorrido independiente contra Floci y conserva los
binarios Playwright en `~/.cache/ms-playwright` con una clave exacta de sistema
operativo y `package-lock.json`.

El ruleset `Main` exige también el check de estado
`provision-test-destroy`, además de las puertas existentes de frontend,
Terraform, seguridad y E2E. Para un cambio que requiere AWS, la PR no se
integra sin completar su validación y teardown. Para documentación y
herramientas PDF explícitas, el job termina con éxito tras la evaluación,
sin asumir OIDC, aprovisionar ni destruir recursos.

### Elegibilidad de herramientas PDF — #186

Corrección aprobada por el responsable el 2026-10-25: el diff de la PR completa
incluía scripts/workflow de publicación de la memoria y una entrada npm,
clasificados como código desplegable aunque no afectan al producto AWS.

Se reconocen sólo las rutas exactas de tooling PDF declaradas en
`scripts/lib/ephemeral-pr-eligibility.mjs`. El selector de origen integrado y
el exportador de datos, sus declaraciones y pruebas se incluyen al añadir
el callback de publicación post-merge. No se eximen directorios genéricos de
scripts, pruebas ni workflows. `package.json` requiere comparar ambos
contenidos: eliminando únicamente `scripts.paper:pdf`, el resto debe ser
semánticamente idéntico. Se usa el mismo merge-base que el diff de archivos,
incluso si `origin/main` ha avanzado. Un error de lectura/parseo conserva AWS.
Los cambios mixtos, las dependencias, el lockfile, la aplicación, Terraform,
otros workflows y el propio control de elegibilidad conservan su clasificación.

La PR #187 también modifica ese control: su excepción concreta se basa en la
aprobación explícita del responsable y el mecanismo ya existente de
`skip-ephemeral-approved` para autores confiables. No es una autoexención
general del control. Las comprobaciones de código, tipos, build, seguridad,
E2E, actionlint y compilación PDF permanecen activas. Una futura PR limitada
a texto/tooling PDF se omite automáticamente sin esa etiqueta.

La [evidencia de #186](../evidence/issue-186-memoria-pdf-releases.md) distingue
regresiones con Git sintético, clasificación automática y excepción operativa
de esta PR. Cancelar una ejecución pendiente sin jobs no sustituye el teardown
de una ejecución que ya aprovisionó recursos; ésta se deja completar su limpieza.

## Alternativa rechazada

Se rechazan `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, tokens de sesión
persistidos y perfiles AWS configurados como GitHub secrets. Aunque permitirían
el mismo apply, amplían la vida, distribución y superficie de revocación de las
credenciales, y no vinculan la asunción a una ejecución concreta de PR.

## Consecuencias

La cuenta requiere una configuración única descrita fuera del código: bucket de
estado, proveedor OIDC, rol limitado y dos variables GitHub no secretas. Un
fallo de provisioning o pruebas puede dejar recursos sólo si AWS o GitHub
impiden el paso final; el runbook incluye la recuperación PR-específica. El
operador rota o revoca acceso cambiando la policy o trust del rol, no secretos
distribuidos. No se concede acceso OIDC a forks.

## Evolución de permisos del rol

El rol externo conserva una política base para Terraform y una política
administrada permanente, versionada en
[`infra/iam/ephemeral-pr-extensions.json`](../../infra/iam/ephemeral-pr-extensions.json),
para las acciones añadidas al stack y a sus pruebas desplegadas. La política
usa ARNs `findly-pr-*` de esta cuenta y región y exige etiquetas de PR cuando
la acción sólo admite `Resource: "*"`. Cada acción nueva se revisa y se
incorpora a esta política una vez; el workflow de PR no puede modificarla.

El rol compartido puede operar recursos efímeros de otros números de PR dentro
de ese prefijo. Se acepta ese alcance para evitar políticas manuales por PR;
el trust sigue limitado a pull requests internos y los recursos `demo`,
`production` y el bucket externo de estado quedan fuera de la ampliación.
La aceptación de una PR nueva y el teardown verifican el cambio antes de retirar
las políticas históricas ligadas a números concretos.

## Revisión operativa de permisos en PR #71

La ampliación aprobada del rol externo se aplica como política adicional
limitada a PR #71 y se versiona como JSON de evidencia; no modifica el trust
OIDC ni sustituye las políticas existentes. Una aprobación concreta no concede
ampliaciones futuras: las denegaciones adicionales se revisan por separado.
El fallo de lectura SNS durante teardown se recupera con el mismo backend y
plan de destrucción inspeccionado, conservando el estado y su lock.
Véase `docs/runbooks/issue-70-aws-review.md` para el estado real y los alcances.
