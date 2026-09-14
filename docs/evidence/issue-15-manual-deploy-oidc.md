# Evidencia de despliegue manual seguro mediante OIDC

Implementación de la spec 14 (issue #15): workflow de despliegue manual
(`workflow_dispatch`) autenticado vía OIDC federado, sin credenciales
estáticas, y los 3 roles IAM por entorno que consume.

## Alcance verificado

- `.github/workflows/deploy.yml`: evoluciona el placeholder intencional ya
  existente ("pending the platform team's Terraform implementation") en
  vez de crear un `cd.yml` duplicado. `workflow_dispatch` con selector de
  entorno (`sandbox`/`demo`/`production`), `environment:
  ${{ inputs.environment }}` (gate de aprobación de GitHub Environments),
  `permissions: { id-token: write }` — **ausente en el YAML de ejemplo de
  la propia spec 14**, sin él `aws-actions/configure-aws-credentials` no
  puede solicitar el token OIDC y el workflow falla en el primer paso.
  Pasos: `terraform apply` sobre `infra/environments/{entorno}`, build +
  `aws s3 sync dist/ ... --delete`, invalidación de CloudFront por
  `Comment`. Validado con `actionlint` (0 errores) y `prettier` (añadido a
  `lint:format`, que antes no cubría ningún workflow salvo `ci.yml` y
  `enable-automerge.yml`).
- `infra/modules/github-oidc/` reescrito: de un rol compartido
  (`findly-github-ci-cd`, sin permisos) a 3 roles independientes
  (`findly-github-actions-{sandbox,demo,production}`, vía `for_each`),
  cada uno con:
  - Confianza OIDC restringida al claim `sub` que GitHub emite cuando el
    job usa `environment: <nombre>` (`repo:{repo}:environment:{entorno}`)
    — más preciso que restringir solo por rama/ref, y encaja
    exactamente con lo que `deploy.yml` ya hace.
  - Una política de despliegue de mínimo privilegio real (antes
    inexistente, deliberadamente diferida en la issue #12 "hasta que la
    spec 14 defina las acciones"), cubriendo cada tipo de recurso de los
    7 módulos existentes: backend de estado Terraform, S3 (gestión de
    buckets + `s3 sync` de despliegue), CloudFront, Lambda, IAM (roles
    propios de cada Lambda + el proveedor OIDC propio, para poder
    reaplicarse a sí mismo), DynamoDB, SQS, EventBridge Scheduler,
    CloudWatch Logs/Alarms, Cognito y API Gateway v2. `Resource: "*"` solo
    donde AWS no admite ARN de recurso para esa acción concreta (algunas
    acciones `Create`/`List` de CloudFront y Cognito) — documentado
    inline en cada caso, no un comodín general.

## Hallazgos corregidos durante la implementación

- **Huella SHA-1 del proveedor OIDC incorrecta desde la issue #12:** el
  valor `6938fd4d98bab03faadb97b34396831e3780aea` (ya fusionado a `main`)
  tiene 39 caracteres, no 40 — `terraform validate` lo rechaza
  (`expected length of thumbprint_list.0 to be in the range (40 - 40)`).
  Además de estar mal transcrito, correspondía a una cadena de
  certificados DigiCert desactualizada: la cadena real de
  `token.actions.githubusercontent.com` verificada en directo con
  `openssl s_client` en el momento de escribir este módulo usa ahora Let's
  Encrypt (raíz ISRG Root X1). Se sustituye por la huella correcta y
  vigente, verificada criptográficamente, no adivinada:
  `ab9d0263244dd0326eb67015705a667e79cfe998`.
- **`aws_cloudfront_distribution.web` nunca fijaba `comment`:** el paso de
  invalidación de caché de `deploy.yml` localiza la distribución por
  `Comment == 'findly-{entorno}'`; sin ese argumento, la consulta nunca
  encontraría ninguna distribución. Añadido a
  `infra/modules/cloudfront/main.tf`.

## Pendiente

- **Bloqueante estructural, no solo de despliegue:** `deploy.yml` hace
  `cd infra/environments/{entorno}` — ese directorio, el backend remoto
  S3+DynamoDB y el bloque `provider "aws"` son responsabilidad explícita
  de la issue #11 (spec 10), no implementada. El workflow incluye un paso
  de verificación previa que falla con un mensaje explícito
  (`::error::... depends on issue #11`) en vez de un error de shell
  opaco, pero el pipeline no es funcional hasta que esa issue exista.
- **Configuración manual pendiente en GitHub (no automatizable sin un
  proveedor Terraform adicional):** los 3 GitHub Environments
  (`sandbox`, `demo`, `production`) deben crearse en Settings → Environments
  del repositorio para que el claim `sub` que emite GitHub coincida con la
  condición de confianza de cada rol. Añadir el proveedor Terraform
  `integrations/github` solo para esto se consideró fuera de alcance de
  esta issue.
- **Aislamiento de recursos incompleto entre entornos:** los 3 roles están
  separados (una ejecución de workflow contra `sandbox` no puede asumir el
  rol de `production`), pero su política de permisos es idéntica hoy,
  porque ningún módulo existente sufija sus nombres de recurso AWS por
  entorno (`findly-photos-queue`, no `findly-photos-queue-sandbox`).
  Aislamiento de recursos real requiere que la issue #11 adopte sufijos de
  entorno y que esta política se actualice para filtrar por ellos.
  Documentado también como comentario inline en el módulo.
- La política de despliegue no se ha probado con `terraform plan`/`apply`
  reales — ningún entorno existe todavía para probarla end-to-end.
- No se abre ADR nuevo: las correcciones (huella OIDC, `id-token: write`,
  `comment` de CloudFront) son correcciones de implementación de lo que
  las specs 11/14 ya piden, no decisiones arquitectónicas nuevas. La
  política de permisos por servicio es la aplicación directa del
  principio de mínimo privilegio que la spec 11 ya exige.

## Validación

```text
npm run typecheck            PASS
npm run lint:code             PASS
npm run lint:markdown         PASS
npm run lint:format           PASS sobre deploy.yml de forma aislada
                               (`npx prettier --check`); el fallo agregado
                               de `npm run lint:format` es el gap de CRLF
                               de Windows ya documentado en issues previas,
                               no algo introducido aquí
npm run test                  PASS (79 tests, sin cambios de app)
npm run build                  PASS
terraform validate (módulos)   PASS (github-oidc reescrito y cloudfront
                               modificado, validados de forma
                               independiente cada uno)
npm run terraform:format       PASS (recursivo)
npm run terraform:validate     PASS (raíz infra/, sin cambios)
npx github-actionlint          PASS (los 4 workflows del repositorio,
                               incluido deploy.yml)
npm run security                PASS (0 vulnerabilidades en dependencias de
                               producción)
npm run sync:check              PASS
```

No se ejecuta `npm run test:e2e`: ningún flujo de usuario visible cambia
en esta issue.
