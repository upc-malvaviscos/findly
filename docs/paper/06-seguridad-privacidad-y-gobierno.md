# 6. Seguridad, privacidad y gobierno

## Consentimiento y minimización de datos

El esquema de validación (`src/shared/lib/validations.ts`, Zod) exige
`consentBiometrics: true` y `consentTerms: true` como literales — no
booleanos cualesquiera — antes de aceptar una inscripción; el backend
rechaza con `400` cualquier valor que no sea exactamente `true` (spec 09,
ADR-003). Findly minimiza por diseño lo que persiste de una selfie:

- **Se almacena**: la imagen original en S3 privado (ADR-003, con TTL de
  retención), y el `FaceId` que devuelve Rekognition — un identificador
  opaco, no un vector ni una imagen.
- **Nunca se almacena**: el vector de _embedding_ facial en DynamoDB, ni
  copias adicionales de la selfie fuera del bucket privado.
- El correo del asistente es **opcional** (`RegistrationRequest.email?`); la
  galería y el derecho al olvido funcionan enteramente con el token opaco,
  sin necesitarlo.

## Autenticación: dos planos distintos

| Plano                          | Mecanismo                                                                                 | Ámbito                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------- |
| Público (asistentes)           | Sin identidad de usuario; autorización por **capacidad**: el token opaco de galería.      | Inscripción, sondeo, galería, borrado. |
| Administración (organizadores) | Amazon Cognito, `USER_PASSWORD_AUTH`, sin secreto de cliente (`generate_secret = false`). | `/admin/*` únicamente.                 |

La política de contraseña del User Pool exige 12 caracteres mínimo con
mayúsculas, minúsculas, números y símbolos. El JWT emitido se valida en API
Gateway mediante un autorizador nativo (`aws_apigatewayv2_authorizer` tipo
`JWT`, audiencia = App Client), no dentro del código de cada Lambda: una ruta
mal configurada falla de forma cerrada en la propia puerta de entrada, antes
de invocar ninguna función.

### Tokens opacos de galería (ADR-005)

El token que recibe el asistente es aleatorio; DynamoDB sólo guarda su hash
SHA-256 como clave de partición (`TOKEN#{tokenHash}`). Ni el token en claro ni
la cabecera `X-Gallery-Token` se registran en ningún log: la lista cerrada de
campos del logger estructurado (capítulo 7) no tiene un campo para él, así
que no puede llegar a CloudWatch por un descuido futuro. La URL de galería no
codifica identidad, correo ni `registrationId`.

## Acceso privado a objetos S3

Todos los buckets de Findly (cargas, estado de Terraform, web) tienen las
cuatro banderas de `aws_s3_bucket_public_access_block` activas y cifrado
SSE-S3 (AES256) por defecto; ninguno admite una política de acceso público.
El acceso de lectura o escritura se concede exclusivamente mediante:

- **URLs prefirmadas** de corta duración: 300 segundos para subidas de
  selfies y fotos, y para la descarga desde la galería (renovadas en cada
  petición, nunca reutilizadas más allá de su vigencia).
- **CloudFront con Origin Access Control (OAC)** para la web estática: el
  bucket sólo confía en peticiones firmadas por esa distribución concreta,
  igual que una API Gateway sólo confía en su propio autorizador.

Las selfies añaden una restricción adicional que ninguna otra subida tiene:
la cabecera `If-None-Match: *` (ADR-014) convierte el `PUT` en una escritura
de una sola vez a nivel del propio servicio S3 — un intento de sobrescribir
una selfie ya subida recibe `412 Precondition Failed` del servicio, no de un
chequeo de aplicación que se pudiera saltar.

## IAM de mínimo privilegio, Lambda por Lambda

Cada función Lambda tiene su propio rol de ejecución, sin compartir permisos
con ninguna otra — no existe un rol "genérico de Lambda" en todo el proyecto.
La tabla resume el patrón (el capítulo 4 detalla un ejemplo completo de
política):

| Lambda               | Acciones concedidas (resumen)                                                                                      | Alcance del recurso                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `publicEvents`       | `dynamodb:Query`/`GetItem`                                                                                         | Tabla e índice `GSI2`, sólo lectura                         |
| `publicEnrollment`   | `dynamodb:PutItem`/`GetItem`/`UpdateItem`                                                                          | Sólo sus propios ítems `REG#`/`TOKEN#`                      |
| `selfieIndexer`      | `s3:GetObject`/`DeleteObject`, `rekognition:IndexFaces`/`ListFaces`/`CreateCollection`/`TagResource`/`DeleteFaces` | Prefijo `events/*/selfies/*`; colección `{entorno}-event-*` |
| `photoMatcher`       | `sqs:ReceiveMessage`/`DeleteMessage`, `rekognition:IndexFaces`/`SearchFaces`/`DeleteFaces`                         | Su propia cola; misma colección aislada por entorno         |
| `adminEvents`        | `dynamodb:Query`/`PutItem`/`GetItem`, `s3:PutObject`                                                               | `GSI2`; prefijo `events/*/photos/*`                         |
| `gallery`            | `dynamodb:GetItem`/`Query`, `s3:GetObject` (para firmar)                                                           | Sus propios ítems por token                                 |
| `deleteRegistration` | `dynamodb:DeleteItem`/`GetItem`/`Query`, `s3:DeleteObject`, `rekognition:DeleteFaces`                              | Sólo el registro identificado por el token                  |
| `retentionPurger`    | `dynamodb:Query` (`GSI2`), `rekognition:DeleteCollection`, `s3:ListBucket`/`DeleteObjects`                         | Eventos caducados detectados en la propia consulta          |

Ningún rol usa `Resource = "*"` salvo donde AWS no admite un ARN de recurso
para esa acción concreta (documentado inline en cada módulo Terraform,
capítulo 4). Los grupos de log de CloudWatch también están acotados: cada
Lambda sólo puede escribir en el suyo propio (`logs:CreateLogStream`/`PutLogEvents`
sobre `{su-log-group-arn}:*`), no en el de otra función.

## Autenticación federada para CI/CD (OIDC)

Ningún workflow de GitHub Actions almacena una clave de acceso de AWS como
secreto. La autenticación usa OpenID Connect: GitHub emite un token firmado
para cada ejecución de _job_, y AWS lo intercambia por credenciales
temporales vía `sts:AssumeRoleWithWebIdentity`, sujeto a una condición de
confianza que compara el _claim_ `sub` exacto que GitHub incluye en ese
token — no basta con que la llamada venga de "GitHub", tiene que venir de
**esta** ejecución concreta.

- **Rol del entorno efímero** (`findly-github-ephemeral-pr-ci`): confía
  únicamente en `sub = repo:upc-malvaviscos/findly:pull_request`. No autoriza
  ninguna rama, ningún _environment_ de GitHub ni ningún fork; sus permisos
  Terraform están acotados por prefijo de recurso `findly-pr-*` y por
  etiqueta `Ephemeral=true` (`docs/runbooks/issue-70-aws-review.md`).
- **Roles de despliegue manual** (`AWS_DEPLOY_ROLE_ARN`): uno por
  _environment_ de GitHub (`sandbox`/`demo`/`production`), cada uno con la
  misma variable pero un valor distinto scopeado a ese _environment_, y una
  confianza restringida al _claim_ `sub` que GitHub emite cuando el job usa
  `environment: <nombre>` — más preciso que confiar sólo en la rama.

**Nota de trazabilidad de código**: el repositorio conserva un módulo
`infra/modules/github-oidc/` de una iteración anterior (issue #12) que
declara un único rol genérico (`findly-github-ci-cd`) sin política de
permisos adjunta. **Ningún root de Terraform lo instancia hoy** — ni
`findly-stack`, ni `infra/ephemeral`. Los roles realmente usados en
producción (los dos puntos anteriores) se crean y revisan manualmente fuera
de Terraform, según los runbooks de configuración externa, precisamente para
que cada ampliación de permiso pase por una aprobación explícita de la
persona responsable (capítulo 2) en vez de por un `apply` automático. Este
capítulo describe el mecanismo real; el módulo huérfano no se presenta como
la fuente de verdad.

## Derecho al olvido y eliminación de biometría

`deleteRegistration` (ADR-013) ejecuta, en este orden, una secuencia no
atómica pero **idempotente ante reintento**: `rekognition:DeleteFaces` del
`FaceId` indexado, `s3:DeleteObject` de la selfie, y el borrado en DynamoDB de
cada coincidencia, el registro y el token — de modo que repetir la operación
tras un fallo parcial no produce un estado inconsistente ni un error (el
capítulo 4 muestra el diagrama de secuencia completo). Tras el borrado, el
mismo token de galería devuelve `404`.

Los `FaceId` de limpieza pendiente son datos sensibles por sí mismos y se
restringen a la tabla y a los roles del propio entorno; nunca aparecen en un
log ni en una respuesta pública (ADR-013). Las colecciones de Rekognition se
aíslan por entorno y evento (`{proyecto}-{entorno}-event-{eventId}`,
ADR-015): un rol de `sandbox` no puede, ni por error de configuración,
consultar o borrar caras de `demo` o `production`, porque el ARN de la
política IAM ya restringe el patrón de nombre.

## Clasificación y etiquetado de datos

Todo recurso Terraform lleva `Project`, `Environment`, `ManagedBy`,
`CostCenter` y `DataClass` (`biometric` en entornos reales, `synthetic` en el
efímero de PR y en `sandbox` de desarrollo) — la etiqueta `DataClass` permite
auditar qué recursos tratan datos sensibles sin inspeccionar su contenido.

## Limitaciones de privacidad conocidas, no ocultadas

- **El TTL de DynamoDB no es un borrado inmediato**: AWS lo documenta como un
  proceso en segundo plano, típicamente dentro de un plazo de días, no un
  borrado síncrono al expirar. La garantía de borrado demostrable de Findly
  depende de `deleteRegistration` (a petición) y de `retentionPurger` (por
  caducidad), no del TTL en sí — el TTL es un mecanismo de limpieza
  adicional, no la prueba de cumplimiento (análisis de la issue #49).
- **El consentimiento no tiene versión ni historial de revocación**: se
  guarda como un booleano y una marca de tiempo (`consentTimestamp`) en el
  propio registro, sin un registro _append-only_ de eventos de consentimiento
  ni una forma de revocarlo sin borrar toda la inscripción. Sin patrón
  definido todavía (issue #49, capítulo 9).
- **La migración de colecciones Rekognition heredadas sigue pendiente**: las
  creadas antes de ADR-015 (`findly-event-{eventId}`, sin sufijo de entorno)
  no se borran ni se migran automáticamente al desplegar el cambio.
