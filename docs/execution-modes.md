# Modos de ejecución local

Findly separa los modos locales para que una demostración rápida, una
integración emulada y una comprobación AWS real no compartan datos,
credenciales ni afirmaciones de cobertura.

## Todo local con mocks

```sh
npm run dev:mocks
```

No requiere Docker ni AWS. La SPA usa adaptadores simulados de inscripción,
administración y subida. El organizador de demostración es `organizer` con
contraseña `findly-local-only`; no son credenciales ni secreto y este adaptador
no puede activarse en una compilación de producción. Abre
`http://127.0.0.1:5173/admin/login`.

Sirve para explorar UI y pruebas unitarias. No prueba Lambda, DynamoDB, S3,
CORS ni Cognito.

## Local con Floci

```sh
npm run dev:floci
```

Inicia Floci, siembra datos sintéticos, levanta la API local y abre Vite en
`http://127.0.0.1:5173`. El mismo organizador sintético permite probar el
panel manualmente. Al detener el comando, Compose elimina contenedores,
volúmenes y huérfanos.

Los puertos `FLOCI_PORT`, `LOCAL_API_PORT` y `WEB_PORT` son configurables para
worktrees. Este modo prueba Lambda contra servicios emulados, pero Cognito
sigue siendo un adaptador local.

## Local contra AWS sandbox

```sh
FINDLY_TERRAFORM_STATE_BUCKET=<bucket> npm run dev:aws
```

Requiere una sesión AWS temporal activa y un bucket de estado externo. Acepta
opcionalmente `AWS_PROFILE=<perfil>` para seleccionar un perfil y
`FINDLY_AWS_REGION` (por defecto, `eu-west-1`). Usa sólo el estado
S3 cifrado y bloqueado `findly/sandbox/terraform.tfstate`; aplica `infra/` para
`environment=sandbox` y nunca apunta a producción ni al root efímero de PR.

Tras el apply crea un usuario Cognito sintético único y muestra sus credenciales
sólo en la terminal; lo elimina al detener Vite. Para desmontar todo:

```sh
FINDLY_TERRAFORM_STATE_BUCKET=<bucket> \
  npm run dev:aws-destroy -- --confirm
```

Sin `--confirm`, falla antes de cambiar AWS. No se guardan estados,
credenciales ni outputs en el repositorio.

## Reglas comunes

- Usa exclusivamente imágenes, tokens, eventos y usuarios sintéticos.
- No añadas perfiles, claves, contraseñas ni `.tfvars` al repositorio.
- El CI efímero de PR conserva OIDC y `destroy`; no se sustituye por el
  sandbox compartido.
