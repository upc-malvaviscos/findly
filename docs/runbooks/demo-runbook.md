# Runbook de demostración

Cuatro niveles, en orden de lo que es ejecutable hoy por cualquier persona
ajena al equipo a lo que sigue bloqueado para la cuenta compartida de este
equipo en concreto. Ninguno usa datos ni imágenes reales de terceros sin
autorización (AGENTS.md). Secuencia por nivel: Inscripción -> Carga masiva
admin -> Galería privada -> Derecho al olvido -> Teardown.

## Nivel 1: local con Floci (ejecutable hoy, sin cuenta AWS)

```sh
nvm install 24 && nvm use 24
npm ci
npm run harness:check:e2e
docker compose up -d floci
docker compose run --rm local-seed
docker compose up -d local-api
VITE_FINDLY_EXECUTION_MODE=floci VITE_API_BASE_URL=http://127.0.0.1:8787 npx vite --host 127.0.0.1 --port 5173
```

En Windows, usa `127.0.0.1`, no `localhost`, en `VITE_API_BASE_URL`: algunos
entornos Docker Desktop no enrutan `localhost` al puerto publicado del
contenedor. `npm run dev:floci` automatiza esta secuencia en Linux/macOS; en
Windows falla al lanzar Vite (`spawn npm ENOENT`), así que lánzalo aparte
como arriba.

1. **Inscripción**: abre `http://127.0.0.1:5173/`, acepta el consentimiento y
   sube una imagen sintética. El organizador de demostración es
   `organizer`/`findly-local-only` (no son credenciales reales; no
   funcionan en una compilación de producción).
2. **Carga masiva admin**: entra en `/admin/login`, crea un evento y sube una
   fotografía sintética desde el panel; el progreso llega al 100 %.
3. **Galería privada**: abre
   `http://127.0.0.1:5173/gallery?token=demo-gallery` (dato sembrado por
   `local-seed`). Verás el evento «Findly Demo Night» y dos marcadores de foto:
   son placeholders sintéticos de 13 bytes etiquetados `image/jpeg`, no
   imágenes reales, así que aparecen como icono roto por diseño.
4. **Derecho al olvido**: pulsa «Eliminar mis datos» en la galería y confirma;
   la galería del mismo token pasa a «no encontrada».
5. **Teardown**: `Ctrl+C` en Vite y `docker compose down --volumes --remove-orphans`.

Validación automatizada equivalente:
`npm run test:e2e:local` (Playwright + Floci) ejecuta este mismo recorrido sin
intervención manual; `npm run test:e2e` cubre el equivalente con el mock del
navegador. Ninguno de los dos activa Rekognition ni Cognito reales.

## Nivel 2: AWS efímero de pull request (real, pero transitorio y sólo desde CI)

El único entorno con Rekognition, Cognito y S3 **reales** hoy es el que crea
`.github/workflows/ephemeral-pr-e2e.yml` para cada pull request interna no
draft: aprovisiona `infra/ephemeral`, ejecuta un recorrido de organizador y
[el smoke ampliado de la aceptación de #70](issue-70-acceptance.md), y destruye
el stack incluso si algo falla. No es una demostración navegable de forma
persistente — el stack existe sólo mientras corre el workflow — pero es la
evidencia AWS real más reciente y completa (capítulo 8 de la memoria,
[`docs/evidence/issue-70-integration.md`](../evidence/issue-70-integration.md)).
Reproducirlo exige abrir una pull request contra este repositorio y los
permisos IAM descritos en [`issue-70-aws-review.md`](issue-70-aws-review.md);
no es algo que una persona externa sin acceso al repositorio pueda ejecutar
por sí misma.

## Nivel 3: AWS `sandbox` real desde tu propia cuenta

**Bloqueado hoy sólo para la cuenta compartida del equipo** (un AWS Learner
Lab educativo cuya política deniega `s3:CreateBucket` en `eu-west-1`;
`docs/evidence/issue-11-terraform-remote-state.md`, issue #61). Con cualquier
cuenta AWS sin esa restricción, este nivel es **ejecutable de principio a fin
hoy mismo, sin GitHub Actions ni un dominio propio**: un único comando
(`npm run dev:aws`) aplica Terraform contra AWS real, crea un organizador de
Cognito temporal y sirve la SPA localmente ya conectada al backend real. La
guía completa, con cada comando exacto y el recorrido manual de la demo
(incluida la limitación de que Rekognition ya compara rostros reales, no
placeholders sintéticos), está en
[`aws-deployment-guide.md`](aws-deployment-guide.md).

## Nivel 4: demo persistente publicada; producción sin verificar

Demo está configurada y su ciclo AWS se verificó el 2026-10-03: publicación
HTTPS/OAC, Cognito, evento, inscripción/PUT/CORS, matching y galería desde el
navegador. Se comprobó después el borrado del stack y sus datos, con estado
vacío y backend compartido conservado. El ciclo de aceptación terminó con la
demo destruida; para una nueva sesión hay que desplegarla de nuevo.

Seguir [el procedimiento de demo permanente](permanent-demo.md): roles OIDC
independientes, cuatro actores autorizados, main protegido, preparación de IDs,
publicación y destrucción manual con confirmación. No recrear el backend
compartido ni usar los comandos de sandbox para demo. Dominio y certificado
pueden quedar vacíos para usar HTTPS en CloudFront (ADR-016).

Esta evidencia acredita los recorridos existentes; las nuevas funcionalidades
MVP de specs 20-23 tienen aceptación propia. Producción no se acredita con el
ciclo de demo.

## Ciclo de demo permanente (issue #15)

El despliegue, roles independientes, preparación de IDs, destrucción manual y
recuperación se describen en [el runbook de demo permanente](permanent-demo.md)
y ADR-017. Runs, resultados, fallos y recuperación constan en
[la evidencia de #15](../evidence/issue-15-permanent-demo.md); el CI efímero
conserva una aceptación independiente.
