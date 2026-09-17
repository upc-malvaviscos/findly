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
5. Añade una alarma o consulta de costes filtrada por `Ephemeral=true` y una
   revisión operativa de recursos `Environment=pr-*` que sobrevivan a un run.

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
