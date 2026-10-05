# 04 - Administración y autorización con Cognito

## Objetivo

Restringir la creación de eventos y la subida masiva de fotografías exclusivamente a organizadores autenticados mediante AWS Cognito User Pools, protegiendo las rutas administrativas en la SPA y en API Gateway HTTP API mediante autorizadores JWT.

## Alineación con AWS Well-Architected Framework

- **Seguridad**: Autenticación centralizada con Cognito User Pools, autorizador JWT en API Gateway y gestión de tokens en memoria de la SPA (sin credenciales estáticas ni `localStorage`).
- **Eficiencia del Rendimiento**: Subida masiva paralela a S3 regulada mediante un pool de concurrencia cliente de máximo 3 cargas simultáneas.

## Requisitos de Arquitectura e Infraestructura AWS

### Provisión de Cognito (Terraform)

- **User Pool**: Configurado con política de contraseñas robusta (mínimo 12 caracteres, mayúsculas, minúsculas, números y símbolos).
- **Client App**: Cliente de App Cognito sin secreto cliente (`generate_secret = false`) para uso seguro en SPA React + Vite.
- **API Gateway HTTP API Authorizer**: `aws_apigatewayv2_authorizer` configurado con tipo `JWT` y audiencia del Cognito Client App.

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Configurar el Contexto de Autenticación

- En `src/context/AuthProvider.tsx`, crea el contexto React que almacena el ID Token exclusivamente en memoria.
- Proporciona las funciones `login(username, password)` y `logout()`.

### Paso 2: Crear el Interceptor de Peticiones API

- Crea `src/lib/apiClient.ts` utilizando `fetch` o `axios` para adjuntar la cabecera `Authorization: Bearer <ID_TOKEN>` en todas las llamadas administrativas.

### Paso 3: Construir el Subidor Masivo (`BulkPhotoUploader`)

- En `src/components/admin/BulkPhotoUploader.tsx`, implementa la cola de subida.
- Solicita las URLs mediante `POST /admin/events/{eventId}/photos/uploads` y usa un pool que procese máximo 3 archivos simultáneamente invocando `uploadFileToS3`.
- La creación y lista de eventos usan `POST /admin/events` y `GET /admin/events` respectivamente.

## Errores Comunes a Evitar (Pitfalls)

- ❌ **ERROR**: Almacenar los tokens JWT en `localStorage`.
  - _Solución_: `localStorage` es vulnerable a ataques XSS. Guarda los tokens exclusivamente en el estado en memoria de React.
- ❌ **ERROR**: Lanzar 50 subidas paralelas a S3 sin limitar concurrencia.
  - _Solución_: Saturará el navegador y la red. Controla la concurrencia a máximo 3 cargas activas a la vez.

## Lista de Verificación Pre-PR (Junior Checklist)

- [x] Intentar acceder a `/admin/events` sin autenticar redirige limpiamente a `/admin/login`.
- [x] La sesión expira en memoria y el guard vuelve a mostrar login sin pantalla en blanco.
- [x] La subida masiva de fotos muestra barra de progreso por archivo y resumen global.

## Estado de implementación

La issue GitHub [#5](https://github.com/upc-malvaviscos/findly/issues/5)
queda trazada por esta spec, sus pruebas y la evidencia asociada.

La SPA autentica mediante `USER_PASSWORD_AUTH` contra Cognito con las
variables públicas `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID` y
`VITE_COGNITO_REGION`. El ID token permanece exclusivamente en memoria; si
falta configuración, el login falla explícitamente y no se habilita un modo
demo. Con `VITE_API_BASE_URL`, la UI lista, crea y selecciona eventos reales
y solicita URLs antes de cargar lotes JPEG con concurrencia máxima de tres.

`src/lambdas/adminEvents.ts` implementa los tres handlers, con validación Zod,
GSI2 para listar, metadatos `Photo` con TTL y URLs `PUT` de 300 segundos. El
módulo `infra/modules/admin-api` une sus Lambdas a las rutas `/admin/*` con un
autorizador JWT de Cognito, log groups, permisos explícitos de API Gateway e
IAM mínimo por handler. La sesión expira mediante su `expiresAt` en memoria y
el guard renderiza login de nuevo sin una pantalla en blanco.

La verificación incluye el sandbox AWS sintético de `npm run test:aws`: crea un
organizador temporal, confirma que `GET /admin/events` sin JWT devuelve `401`,
autentica contra Cognito, crea un evento y carga un JPEG prefirmado. Tras el
smoke se eliminan los datos sintéticos y el sandbox se destruye de forma
explícita. No se usan credenciales, tokens ni biometría reales.

La evidencia reproducible está en
[`docs/evidence/issue-05-admin-cognito.md`](../docs/evidence/issue-05-admin-cognito.md),
[`docs/evidence/issue-04-frontend-auth.md`](../docs/evidence/issue-04-frontend-auth.md)
y
[`docs/evidence/issue-51-54-local-execution-modes.md`](../docs/evidence/issue-51-54-local-execution-modes.md).

## Retención y nuevas cargas (#70)

El endpoint de fotos lee los metadatos consistentemente y rechaza con
`410 EVENT_EXPIRED` eventos caducados, cerrados o con caducidad inválida.
No firma nuevas capacidades ni escribe Photo mientras los metadatos se
conservan para reintentar una purga. Las fotos de un evento vigente mantienen
PUT de 300 segundos. Las pruebas unitarias verifican ese rechazo; el plan
de aceptación AWS sigue pendiente de ejecución.

<!-- requirement: REQ-ADMIN-AUTH -->

Trazabilidad `REQ-ADMIN-AUTH`: [#5](https://github.com/upc-malvaviscos/findly/issues/5) · [evidencia](../docs/evidence/issue-05-admin-cognito.md).

## Invitaciones y primer acceso (#105)

Issue: [#105](https://github.com/upc-malvaviscos/findly/issues/105).

<!-- requirement: REQ-ADMIN-INVITATIONS -->

El pool sólo permite altas administrativas (`allow_admin_create_user_only`).
Terraform gestiona configuración y cliente, conserva los usuarios existentes y
utiliza la invitación estándar de Cognito sin plantilla personalizada. El enlace
al login del entorno se comunica por separado; la herramienta muestra la URL
pública al operador sin enviar otro mensaje. No contiene cuentas ni contraseñas.
La contraseña temporal caduca en siete días y el challenge en tres minutos.

La herramienta del operador lee usuario/correo por stdin, valida cuenta, región,
pool y etiquetas y rechaza raíz o credenciales sin caducidad conocida. Sin
`--send` sólo valida. Cognito genera la contraseña temporal; no se marcan emails
verificados ni se reenvían invitaciones automáticamente. Todas las cuentas del
pool conservan acceso administrativo completo; no se añaden grupos o niveles.

`/admin/login` distingue la sesión autenticada de `NEW_PASSWORD_REQUIRED` y
permite definir/confirmar la contraseña definitiva. Contraseñas, challenge y
token viven sólo en memoria. Cancelación, caducidad o respuestas tardías no
habilitan acceso ni sobrescriben un login posterior.

Pruebas: login normal, primer acceso, política de contraseña, cancelación,
caducidad, carreras de peticiones y ausencia de almacenamiento persistente. La
aceptación AWS crea cuentas sintéticas con `SUPPRESS`, completa el challenge,
rechaza `SignUp` y exige limpieza/destroy. No prueba entrega real.

Véanse el [runbook](../docs/runbooks/admin-invitations.md) y la
[evidencia](../docs/evidence/admin-invitations-aws-plan.md). La implementación
local no acredita despliegue de producción ni invitación recibida.
