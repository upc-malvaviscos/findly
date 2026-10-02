# Guía de despliegue en AWS mediante Terraform (demo funcional)

Esta guía lleva de cero a una demostración de Findly funcionando contra
servicios AWS reales — DynamoDB, S3, Rekognition, Cognito, API Gateway y
Lambda de verdad, no emulados —, con el máximo detalle posible: cada comando
exacto, qué hace, y qué salida esperar. Está pensada para alguien que no ha
tocado este repositorio antes.

**Nota de honestidad, antes de empezar.** El equipo de este proyecto intentó
este mismo procedimiento en un AWS Learner Lab educativo y el paso 3
(bootstrap del bucket de estado) falló: esa cuenta deniega `s3:CreateBucket`
en `eu-west-1` y bloquea `s3:GetBucketObjectLockConfiguration` por una
política de cuenta (SCP) que el equipo no controla —
`docs/evidence/issue-11-terraform-remote-state.md` documenta el intento
exacto—. **Esto no es un defecto del código ni de esta guía**: es una
restricción de esa cuenta educativa concreta. Con una cuenta AWS normal
(personal, de empresa, o cualquier cuenta sin esa restricción) con permisos
de administrador o un usuario con los permisos IAM equivalentes a los que
Terraform va a necesitar, todo el procedimiento de esta guía funciona de
principio a fin. El bootstrap del paso 3 y el `plan` de sandbox contra ese
backend se verificaron así en una cuenta dedicada en `eu-west-1` (issue #61,
misma evidencia).

## 0. Requisitos

- Una cuenta AWS con permisos suficientes para crear buckets S3, tablas
  DynamoDB, funciones Lambda, colas SQS, un User Pool de Cognito, un HTTP API
  Gateway, colecciones de Rekognition, un tema SNS y un presupuesto de AWS
  Budgets. El más simple es una cuenta donde tu usuario tenga la política
  gestionada `AdministratorAccess` (sólo para este ejercicio de demostración;
  el capítulo 6 de la memoria documenta el IAM de mínimo privilegio que sí
  usa Findly en ejecución).
- **AWS CLI v2** instalado y con una sesión activa: `aws sts get-caller-identity`
  debe devolver tu cuenta sin error. Puede ser un perfil con claves de acceso,
  o —preferible— una sesión temporal (SSO, `aws sso login`, o un rol asumido).
- **Terraform** >= 1.14.0 y < 2.0.0 (`terraform version`).
- **Node.js 24.x** y **npm** >= 11 (`.nvmrc` fija la versión exacta).
- **Git**, para clonar el repositorio.
- **No hace falta** ni Docker ni Floci para esta guía: es AWS real, no el
  entorno local emulado (ese está en `docs/execution-modes.md`).

## 1. Clonar y preparar el repositorio

```sh
git clone https://github.com/upc-malvaviscos/findly.git
cd findly
nvm install 24 && nvm use 24   # si usas nvm; si no, instala Node 24.x manualmente
npm ci
```

`npm ci` instala exactamente las versiones bloqueadas en `package-lock.json`
— no `npm install`, que podría resolver versiones distintas. Comprueba que la
base está sana antes de tocar AWS:

```sh
npm run harness:check
npm run verify
```

Si `harness:check` falla, te dirá exactamente qué herramienta falta y cómo
instalarla — no continúes hasta que pase. `npm run verify` tarda unos minutos
(ejecuta lint, tipos, ~300 pruebas con cobertura, build, validación de
Terraform y auditoría de seguridad); todo debe terminar en verde.

## 2. Confirmar tu sesión AWS

```sh
aws sts get-caller-identity
```

Debe devolver tu `Account`, `UserId` y `Arn` sin error. Si usas un perfil con
nombre distinto al por defecto:

```sh
export AWS_PROFILE=tu-perfil
```

Anota la región que vas a usar; esta guía usa `eu-west-1` (la única región
del proyecto, ADR-004) en todos los ejemplos.

## 3. Bootstrap del bucket de estado de Terraform (una sola vez por cuenta)

`infra/bootstrap` crea el bucket S3 que va a guardar el estado remoto de
todos los entornos. Es la única raíz de Terraform que usa **estado local**
—su propio fichero `terraform.tfstate` se queda en tu disco, no en S3—, así
que ejecútala una sola vez y guarda ese fichero local en un sitio seguro
(no se versiona en Git; `.gitignore` ya excluye `*.tfstate`).

```sh
cd infra/bootstrap
terraform init
terraform plan
```

Revisa el plan: debe crear exactamente un `aws_s3_bucket` con versionado,
cifrado SSE-S3, bloqueo de acceso público, una política que deniega tráfico
sin TLS, y una regla de ciclo de vida que expira versiones no actuales a los
90 días. Nada más. Si el plan se ve bien:

```sh
terraform apply
```

Escribe `yes` cuando lo pida. Al terminar, verás un output:

```text
Outputs:

state_bucket_name = "findly-tfstate-123456789012"
```

**Guarda ese nombre de bucket** (sustituye `123456789012` por tu propio ID de
cuenta, que Terraform ya ha insertado automáticamente) — lo necesitas en
todos los pasos siguientes.

```sh
cd ../..   # vuelve a la raíz del repositorio
```

## 4. Desplegar el entorno sandbox completo

Findly incluye un script que hace **todo el despliegue en un solo comando**:
construye y empaqueta las Lambdas, aplica Terraform, crea un usuario
organizador de Cognito de un solo uso, y levanta la SPA en tu máquina
apuntando ya al backend real desplegado.

```sh
export FINDLY_TERRAFORM_STATE_BUCKET=findly-tfstate-123456789012   # el bucket del paso 3
npm run dev:aws
```

Qué hace exactamente, en orden (código en `scripts/aws-sandbox.mjs`):

1. Exporta tus credenciales AWS activas de forma temporal, sólo para los
   subprocesos de `terraform`/`aws` que lanza — nunca las escribe a disco ni
   se las pasa a Vite.
2. `terraform init` de `infra/environments/sandbox` contra el bucket de
   estado, con la clave `findly/sandbox/terraform.tfstate`.
3. `npm run build:lambdas && npm run package:lambdas` — genera y empaqueta
   las 9 Lambdas antes de aplicar, porque Terraform necesita los `.zip`.
4. `terraform apply -auto-approve` con estas variables fijas: `project=findly`,
   `cost_center=findly`, `data_class=synthetic`, `frontend_domain_url=http://127.0.0.1:5173`
   (o el puerto que fijes con `WEB_PORT`), y `uploads_bucket_name=findly-sandbox-{tu-cuenta}-eu-west-1`.
   Esto aprovisiona **todo el stack**: DynamoDB, el bucket de cargas, API
   Gateway, Cognito, las Lambdas de inscripción pública/matching/galería/
   borrado/retención/administración, el módulo de monitorización (SNS +
   presupuesto) y las colecciones de Rekognition aisladas por entorno.
5. Crea un usuario Cognito temporal (`local-{uuid}`) con una contraseña
   aleatoria fuerte, y los imprime en tu terminal:

   ```text
   Organizer username: local-3f9a1b2c-...
   Organizer password: Xy9k2mP...Aa1!
   The credentials are synthetic and exist only in this sandbox.
   ```

   **Copia ambos valores ahora** — no se guardan en ningún fichero.

6. Lanza Vite en `http://127.0.0.1:5173` con `VITE_FINDLY_EXECUTION_MODE=aws`
   y los endpoints reales de API Gateway y Cognito ya inyectados. La SPA se
   sirve desde tu máquina, pero habla con el backend real desplegado — no
   hace falta CloudFront para esta demostración.

La primera vez, `terraform apply` puede tardar varios minutos (Cognito y las
colecciones de Rekognition son los recursos más lentos de crear). Cuando
termine y Vite arranque, verás la URL local en la terminal; déjala abierta,
el proceso sigue corriendo hasta que lo pares.

## 5. Validar el despliegue automáticamente (opcional pero recomendado)

En **otra terminal**, con la misma sesión AWS y el mismo bucket de estado:

```sh
export FINDLY_TERRAFORM_STATE_BUCKET=findly-tfstate-123456789012
npm run test:aws
```

Esto ejecuta un smoke test de 314 líneas (`scripts/test-aws-sandbox.mjs`) que
crea un usuario, un evento y datos sintéticos aleatorios directamente contra
tu stack recién desplegado, valida los contratos `200`/`404`/`410` de la
galería y las firmas de subida, y **borra sus propios datos de prueba** al
terminar. Si termina sin error, el backend real funciona de extremo a extremo
antes de que hagas nada manualmente en el navegador.

## 6. Recorrido manual de la demo, paso a paso

Con Vite corriendo (paso 4), abre `http://127.0.0.1:5173` en tu navegador.

### 6.1 Panel de organizador

1. Ve a `http://127.0.0.1:5173/admin/login`.
2. Introduce el usuario y la contraseña que copiaste en el paso 4.
3. Pulsa "Entrar". Deberías ver el título "Tus eventos" (vacío la primera
   vez).
4. Rellena "Nombre del evento" (por ejemplo, `Demo AWS`), "Fecha" y
   "Retención (días)" (por ejemplo, `7`).
5. Pulsa "Crear evento". El campo "Evento seleccionado" debe rellenarse con
   un identificador `evt-...`.
6. Selecciona una o varias fotografías **con rostros reales, sintéticas o
   autorizadas** (AGENTS.md prohíbe datos biométricos reales de terceros sin
   consentimiento; usa tus propias fotos o imágenes de stock con licencia
   explícita para pruebas). **Importante**: a diferencia del modo local con
   Floci, aquí Rekognition compara caras de verdad — una imagen sin un rostro
   detectable, o el mismo placeholder sintético de 13 bytes que usa el
   entorno local, no producirá ninguna coincidencia.
7. Pulsa "Subir fotografías" y espera a "Progreso global: 100%".

### 6.2 Inscripción pública con tu propia selfie

1. Abre una pestaña nueva en `http://127.0.0.1:5173/` (o en una ventana
   privada, para no mezclar sesiones).
2. Verás "Encuentra tu momento." y el formulario "Te encontraremos en el
   recuerdo".
3. (Opcional) Introduce un correo electrónico.
4. En "Elige tu mejor retrato", pulsa "Seleccionar foto" o "Usar cámara" y
   sube **una selfie con el mismo rostro** que aparece en alguna de las fotos
   del paso 6.1 — si el rostro no coincide con ninguna foto subida, la
   inscripción se completará igualmente, pero la galería aparecerá vacía.
5. Marca las dos casillas de "Privacidad y consentimiento".
6. Pulsa "Enviar mi selfie". El formulario mostrará el progreso de la subida
   y después el sondeo de estado (`UPLOAD_PENDING` → `PROCESSING` →
   `ENROLLED`). Rekognition suele indexar el rostro en menos de tres segundos
   (spec 00); si el estado llega a `FAILED`, revisa que la imagen contenga un
   rostro claramente visible.

### 6.3 Esperar el matching

`photoMatcher` procesa las fotos del organizador de forma asíncrona por SQS
(capítulo 4 de la memoria). Con una única foto subida, el proceso completo
—indexar, comparar y guardar la coincidencia— tarda normalmente unos
segundos tras la subida del paso 6.1. No hace falta ninguna acción manual
aquí.

### 6.4 Ver la galería privada

Tras completar la inscripción (paso 6.2), la SPA navega o puede navegarse
manualmente a `/gallery?token={el-token-recibido}`. Si el rostro de tu selfie
coincide con alguna foto subida por el organizador con una similitud >= 95 %,
verás el evento y la fotografía; si no coincide con ninguna, verás el estado
de galería vacía.

### 6.5 Derecho al olvido

En la galería, pulsa "Eliminar mis datos" y confirma. La página debe indicar
que tus datos han sido eliminados. Si vuelves a cargar la misma URL de
galería, debe devolver "Galería no encontrada." — el borrado en AWS real
elimina la selfie de S3, el `FaceId` de Rekognition, y el registro, las
coincidencias y el token de DynamoDB (capítulo 6 de la memoria detalla la
secuencia exacta).

## 7. Alternativa: desplegar `demo` mediante el workflow de GitHub Actions

Los pasos 1-6 despliegan `sandbox` desde tu máquina, sin necesidad de GitHub
Actions ni de un dominio propio. Si en cambio quieres una SPA publicada de
verdad con su propio dominio HTTPS (entorno `demo` o `production`), el
camino es distinto y **no** usa `npm run dev:aws`:

1. Crea o reutiliza un certificado ACM en `us-east-1` (obligatorio para
   CloudFront) para tu dominio.
2. Configura en el _environment_ de GitHub correspondiente (`demo` o
   `production`) las variables `AWS_DEPLOY_ROLE_ARN`,
   `AWS_TERRAFORM_STATE_BUCKET`, `FINDLY_UPLOADS_BUCKET_NAME`,
   `FINDLY_WEB_BUCKET_NAME`, `FINDLY_WEB_DOMAIN_NAME` y
   `FINDLY_WEB_CERTIFICATE_ARN` — el rol de despliegue OIDC se crea y revisa
   manualmente fuera de Terraform (capítulo 6 de la memoria explica por qué).
3. Ejecuta el workflow **Deployment** manualmente (`workflow_dispatch`) desde
   la pestaña Actions de GitHub, eligiendo el `environment` y dejando
   `apply=false` la primera vez.
4. Revisa el plan que produce el job (rechaza automáticamente cualquier
   borrado, reemplazo, o recurso de coste fijo — capítulo 5 de la memoria).
5. Si el plan es correcto, vuelve a ejecutar el mismo workflow con
   `apply=true`. Esta segunda ejecución necesita la aprobación del
   _environment_ de GitHub si está configurada, aplica la infraestructura, y
   publica la SPA en el bucket web con invalidación de CloudFront.

Esta ruta es la que documenta en detalle `docs/evidence/issue-15-manual-deploy-oidc.md`
y el capítulo 5 de la memoria; se deja aquí sólo como referencia porque exige
un dominio propio que esta guía no asume que tengas.

## 8. Apagar todo cuando termines

**No dejes el sandbox corriendo indefinidamente**: aunque todos los servicios
son serverless y facturan por uso, algunos (el User Pool de Cognito, las
colecciones de Rekognition) no tienen coste por hora pero sí conviene
destruirlos cuando ya no los necesites, por higiene y para no acumular datos
de prueba.

1. Para la SPA local: `Ctrl+C` en la terminal donde corre `npm run dev:aws`.
   El propio script borra el usuario Cognito temporal automáticamente al
   salir.
2. Para destruir **todo** el stack sandbox:

   ```sh
   export FINDLY_TERRAFORM_STATE_BUCKET=findly-tfstate-123456789012
   npm run dev:aws-destroy -- --confirm
   ```

   Sin `--confirm`, el comando falla explícitamente antes de tocar AWS — es
   intencionado, para que nunca se destruya un entorno por accidente.

3. El bucket de estado del paso 3 **no** se destruye con este comando (tiene
   `prevent_destroy = true`); si quieres eliminarlo también, hazlo
   manualmente desde la consola de AWS o con `terraform destroy` en
   `infra/bootstrap`, sabiendo que perderás el histórico de estado de
   cualquier entorno que hayas desplegado con él.

## 9. Solución de problemas

| Síntoma                                                                    | Causa probable                                                                                        | Solución                                                                                                                                         |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FINDLY_TERRAFORM_STATE_BUCKET is required.`                               | No exportaste la variable de entorno.                                                                 | Repite el `export` del paso 3/4 en la misma terminal donde ejecutas el comando.                                                                  |
| `AccessDenied` al crear el bucket de estado                                | Tu cuenta tiene una restricción de política (SCP), como el Learner Lab del equipo.                    | Usa una cuenta AWS sin esa restricción, o pide a quien administre la cuenta que la revise (ver la nota de honestidad al principio de esta guía). |
| `terraform apply` falla con un error de Rekognition o Cognito ya existente | Ya desplegaste `sandbox` antes en esta cuenta y no lo destruiste.                                     | Ejecuta el paso 8 primero, o cambia el nombre de proyecto/entorno.                                                                               |
| La galería aparece siempre vacía                                           | El rostro de la selfie no coincide con ninguna foto subida, o la similitud queda por debajo del 95 %. | Sube una foto del organizador y una selfie del mismo rostro, con buena iluminación.                                                              |
| `BACKEND_NOT_CONFIGURED` en el navegador                                   | Falta `VITE_API_BASE_URL`; sólo ocurre si lanzas Vite manualmente en vez de con `npm run dev:aws`.    | Usa `npm run dev:aws`, que ya inyecta esa variable automáticamente.                                                                              |
| El estado de inscripción se queda en `FAILED`                              | La imagen no tiene un rostro detectable por Rekognition.                                              | Prueba con una foto distinta, con el rostro bien visible y sin oclusiones.                                                                       |
