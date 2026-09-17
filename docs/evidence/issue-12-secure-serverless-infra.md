# Evidencia de infraestructura serverless segura

Implementación de la spec 11 (issue #12): OIDC federado para GitHub
Actions, Cognito, API Gateway con autorizador JWT y roles IAM propios por
Lambda, y CloudFront + OAC para la SPA.

## Alcance verificado

- `infra/modules/github-oidc/`: `aws_iam_openid_connect_provider` para
  `token.actions.githubusercontent.com` y `aws_iam_role.github_ci_cd` con
  confianza restringida al repositorio `upc-malvaviscos/findly` (`sub`
  configurable vía `allowed_ref`, por defecto cualquier ref del
  repositorio). Sin política de permisos adjunta deliberadamente: los
  permisos concretos de despliegue dependen de acciones que la spec 14
  (issue #15, no implementada) aún no define; adjuntar permisos
  especulativos habría sido sobre-otorgar.
- `infra/modules/cognito/`: User Pool (política de contraseña de 12+
  caracteres con mayúsculas/minúsculas/números/símbolos, según spec 04) y
  App Client sin secreto (`generate_secret = false`).
- `infra/modules/api-gateway/`: HTTP API con CORS restringido al origen
  del frontend; rutas reales para las dos únicas Lambdas HTTP existentes
  (`GET /gallery`, `DELETE /registrations/{registrationId}`), cada una con
  su propio rol IAM de mínimo privilegio (`gallery`: `GetItem`/`Query` en
  la tabla + `s3:GetObject` en el prefijo de fotos, para firmar URLs;
  `deleteRegistration`: `GetItem`/`Query`/`DeleteItem` en la tabla +
  `rekognition:DeleteFaces` + `s3:DeleteObject` en el prefijo de selfies) y
  su `aws_lambda_permission` explícito — resuelve el pitfall que la propia
  spec 11 señala (olvidar el permiso produce `500` en API Gateway). El
  autorizador JWT de Cognito se define (`aws_apigatewayv2_authorizer`,
  audiencia = App Client) pero no se adjunta a ninguna ruta todavía: no
  existe ningún handler administrativo que proteger (issue #5 pendiente).
- `infra/modules/cloudfront/`: bucket S3 privado para `dist/` (mismo
  patrón que `uploads-bucket`: bloqueo total de acceso público,
  SSE-S3/AES256), `aws_cloudfront_origin_access_control`, distribución con
  redirección HTTP→HTTPS y mapeo de errores 403/404 → `index.html` 200
  (necesario porque la SPA enruta en el cliente vía `pushState`).

## Hallazgos y decisiones durante la implementación

- **Solapamiento spec 04 / spec 11 sobre Cognito:** ambas specs reclaman la
  provisión de Cognito como su propio entregable. Se interpreta que la
  spec 04 (issue #5) delega esa infraestructura en "la tarea de
  infraestructura/backend" — spec 11/issue #12 — y se documenta la
  división explícitamente en ambos ficheros: la infraestructura vive aquí,
  los handlers de negocio siguen en la issue #5.
- **TLSv1.2_2021 requiere un dominio propio que no existe todavía:**
  spec 03 exige esa política mínima de TLS, pero AWS solo permite fijarla
  con un certificado ACM propio (SNI) — el certificado por defecto de
  `*.cloudfront.net` no lo admite. Ningún spec de este proyecto define
  todavía un dominio ni una zona Route53. El módulo acepta
  `custom_domain_name`/`acm_certificate_arn` opcionales: sin ellos, usa el
  certificado por defecto (TLSv1 implícito, no TLSv1.2_2021); con ellos,
  aplica exactamente la política exigida. Documentado en el propio
  `main.tf` y aquí — no se inventa un dominio para "aprobar" el checklist.
- **`data.aws_region.current`:** se verificó contra el esquema real del
  proveedor `hashicorp/aws` 5.100.0 que el atributo correcto en esta
  versión es `.name`, no `.region` (que solo existe en versiones
  posteriores) — evita un error de referencia que `terraform validate` no
  habría detectado por sí solo al no evaluar valores de variables no
  fijadas.
- **Gap de empaquetado descubierto y corregido (afecta también a las
  issues #8 y #10):** ninguna Lambda se empaquetaba nunca en `.zip` —
  `build:lambdas` solo generaba `.js` sueltos, pero
  `aws_lambda_function.filename`/`source_code_hash` exigen un `.zip` real.
  Esto ya afectaba silenciosamente a `photo-matching` y
  `retention-purger` (sus variables ya describían rutas `.zip`
  inexistentes desde que se crearon). Se añade
  `scripts/package-lambda-artifacts.mjs` (nuevo paso `npm run
package:lambdas`, sin dependencias nuevas: usa `Compress-Archive` en
  Windows y `zip -j` en Linux/CI) y se amplía
  `scripts/verify-lambda-artifacts.mjs` para comprobar `.js` **y** `.zip`
  de cada Lambda en `src/lambdas/*.ts`, en vez de solo `health.js` como
  antes.

## Pendiente

- Ningún módulo está conectado a una raíz Terraform real ni desplegado
  (issue #11: bootstrap, backend remoto, proveedor AWS). `terraform plan`
  no se ejecuta todavía en ninguno.
- El autorizador JWT de Cognito no protege ninguna ruta real hasta que la
  issue #5 implemente los handlers administrativos.
- `tflint` no está instalado en este entorno local (mismo gap ya
  documentado en issues previas); no se pudo ejecutar contra los módulos
  nuevos.
- No se abre ADR nuevo: todo lo implementado es la declaración directa de
  recursos que la spec 11 ya especifica; la única decisión de diseño
  propia (dominio/certificado opcionales) es una adaptación de
  implementación, no una decisión arquitectónica de alto nivel.

## Evidencia de coste y endurecimiento en CI efímera

El workflow `.github/workflows/ephemeral-pr-e2e.yml` conserva un plan de
Terraform por PR en el directorio temporal del runner y lo convierte con
`terraform show -json`. Antes de `apply`, falla si el plan contiene un recurso
gestionado de los tipos excluidos por el alcance: VPC, NAT Gateway, EC2, RDS,
balanceador de carga o EKS.

Después de aplicar el stack y antes del recorrido del organizador, el mismo job
consulta el bucket de cargas efímero que Terraform acaba de crear. La ejecución
falla salvo que las cuatro banderas de `PublicAccessBlockConfiguration` sean
`true` y el cifrado por defecto sea `AES256` (SSE-S3). Los valores se usan sólo
para las aserciones y no se escriben en el log.

Esta comprobación usa el rol OIDC y el bucket con prefijo de la PR ya previstos
por ADR-008; no añade claves persistentes ni recursos fuera del stack efímero.
La casilla de la issue #12 sólo se actualizará después de que una ejecución de
`provision-test-destroy` de esta PR deje evidencia de ambas aserciones y de su
teardown.

## Mensaje sugerido para la issue #5

> Nota de la issue #12: la infraestructura de Cognito y el autorizador JWT
> de API Gateway ya están provisionados
> (`infra/modules/cognito/`, `infra/modules/api-gateway/` — autorizador
> `aws_apigatewayv2_authorizer.cognito_jwt`, sin ninguna ruta que lo use
> todavía). Al implementar los handlers administrativos, añade sus rutas
> en `infra/modules/api-gateway/main.tf` referenciando ese autorizador
> (`authorizer_id = aws_apigatewayv2_authorizer.cognito_jwt.id` en cada
> `aws_apigatewayv2_route` que corresponda), siguiendo el mismo patrón de
> rol IAM propio + `aws_lambda_permission` ya usado para `gallery`/
> `deleteRegistration` en ese mismo fichero.

## Validación

```text
npm run typecheck            PASS
npm run lint:code             PASS
npm run lint:markdown         PASS
npm run test                  PASS (79 tests, 17 archivos — sin cambios de
                               app; esta issue es infraestructura y
                               tooling de build)
npm run build                  PASS (web + 5 artefactos Lambda .js + .zip)
terraform validate (módulos)   PASS (github-oidc, cognito, api-gateway,
                               cloudfront, validados de forma
                               independiente cada uno)
npm run terraform:format       PASS (recursivo, incluye los 4 módulos)
npm run terraform:validate     PASS (raíz infra/, sin cambios)
npm run security                PASS (0 vulnerabilidades en dependencias de
                               producción)
npm run sync:check              PASS
```

`npm run test:e2e` no se ejecuta: ningún flujo de usuario visible cambia
en esta issue.
