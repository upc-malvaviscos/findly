# Configuración externa: CI efímera de PR

Este documento se aplica en AWS y GitHub; no se copian claves ni secretos al
repositorio. La configuración es de una sola cuenta y debe revisarla quien
administra AWS.

## AWS

1. Crea un bucket S3 de estado dedicado, privado, con versionado, cifrado por
   defecto, bloqueo de acceso público y una política TLS-only. No lo etiquetes
   como efímero ni lo incluyas en el role de destrucción. Conserva su nombre.
2. Crea o reutiliza el proveedor IAM `token.actions.githubusercontent.com` con
   audiencia `sts.amazonaws.com`.
3. Crea el rol `findly-github-ephemeral-pr-ci`. Su trust policy debe requerir
   `aud=sts.amazonaws.com` y exactamente
   `sub=repo:upc-malvaviscos/findly:pull_request`; no autorices ramas,
   environments, repositorios ni forks adicionales.
4. Otorga al rol sólo las acciones Terraform necesarias sobre recursos con
   prefijo `findly-pr-` o etiqueta `Project=findly`, `Ephemeral=true`, y sobre
   el prefijo S3 de estado `ephemeral/pr-*`: S3 state read/write/list/lockfile,
   DynamoDB on-demand, bucket y objetos `findly-pr-*`, HTTP API, Lambdas,
   CloudWatch Logs, roles y policies de Lambda, Cognito User Pools y
   `sts:GetCallerIdentity`. Restringe por ARN y `aws:RequestTag`/
   `aws:ResourceTag` siempre que el servicio lo soporte; niega explícitamente
   recursos sin `Ephemeral=true`, y nunca otorgues `iam:*`, `s3:*` global ni
   permisos sobre `demo`, `production` o el bucket de estado.
   Para el recorrido desplegado, añade únicamente `cognito-idp:AdminCreateUser`,
   `cognito-idp:AdminSetUserPassword` y `cognito-idp:AdminDeleteUser` sobre los
   user pools de CI de esta cuenta, restringidos también por
   `aws:ResourceTag/Project=findly` y `aws:ResourceTag/Ephemeral=true`; el
   workflow crea un usuario por ejecución, no registra su contraseña y lo
   elimina antes del `destroy`.
   Los permisos adicionales para el stack y las pruebas actuales se mantienen
   como política administrada permanente `findly-ephemeral-pr-extensions`, cuyo
   documento revisable es
   [`infra/iam/ephemeral-pr-extensions.json`](../../infra/iam/ephemeral-pr-extensions.json).
   Se aplica a todos los números de PR bajo `findly-pr-*`; no se crea una copia
   por PR. La política limita cuenta, región, nombres y etiquetas. Las acciones
   que AWS exige con `Resource: "*"` tienen condiciones de región, función o
   etiquetas según la acción. Ningún permiso permite modificar la propia
   política o el trust del rol desde una PR.
5. Añade una alarma o consulta de costes filtrada por `Ephemeral=true` y una
   revisión operativa de recursos `Environment=pr-*` que sobrevivan a un run.

### Evolución de permisos del rol efímero

Cuando Terraform o los runners necesitan una acción nueva, modifica primero el
documento permanente del paso 4. Revisa el diff, el ARN y las condiciones de
la acción; valida el JSON con IAM Access Analyzer y simula las acciones que
lo admitan antes de publicar una nueva versión de la política administrada.
La persona operadora actualiza la versión por defecto y verifica su asociación
al rol. Después, una PR nueva debe completar plan, apply, aceptación y destroy
sin una política para su número concreto. El check de GitHub aporta la prueba
desplegada; la simulación IAM por sí sola no sustituye esa ejecución.

En la cuenta actual, la política ya existe. Para una ampliación revisada:

```sh
aws accessanalyzer validate-policy \
  --policy-document file://infra/iam/ephemeral-pr-extensions.json \
  --policy-type IDENTITY_POLICY --profile face-locator-operator
aws iam create-policy-version \
  --policy-arn arn:aws:iam::567158658992:policy/findly-ephemeral-pr-extensions \
  --policy-document file://infra/iam/ephemeral-pr-extensions.json \
  --set-as-default --profile face-locator-operator
```

Si se alcanza el límite de versiones, inspecciona y elimina una versión antigua
que no sea la predeterminada antes de repetir el segundo comando. El documento
contiene la cuenta y región de este proyecto: revisa ambos al migrar de cuenta.

No concedas al rol de la propia CI permisos para crear versiones de políticas
o asociarlas. Las políticas temporales antiguas sólo se retiran después de
confirmar que no hay ejecuciones activas que dependan de ellas y que los
estados efímeros correspondientes están vacíos. Nunca borres el bucket externo
de estado ni sus versiones para limpiar una PR.

## GitHub

En Settings → Secrets and variables → Actions → Variables, crea variables de
repositorio (no secrets):

- `AWS_EPHEMERAL_CI_ROLE_ARN`: ARN del rol del paso 3.
- `AWS_TERRAFORM_STATE_BUCKET`: nombre del bucket del paso 1.

No crees `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, perfiles AWS, `.env` ni
otros secretos para este workflow. Mantén las reglas de PR que exigen el job
`Ephemeral PR environment` antes de merge. En el ruleset `Main`, añade el
contexto exacto de check `provision-test-destroy` a los checks requeridos sin
eliminar `frontend`, `terraform`, `security-and-sync` ni `e2e`.

## Recuperación

Si GitHub o AWS impiden el paso final, usa el mismo rol y la misma clave de
estado `ephemeral/pr-<numero>/terraform.tfstate` para ejecutar `terraform
destroy` desde `infra/ephemeral`, pasando el número de PR y el account ID.
Primero confirma que las etiquetas `Ephemeral=true` y `PullRequest=<numero>`
coinciden. No borres manualmente estado, bucket de backend ni recursos de otro
entorno.
