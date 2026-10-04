# Issue #98: configuración SES y preparación de producción

<!-- requirement: REQ-PRODUCTION-DOMAIN -->

## Alcance y autorización — 2026-10-04

Seguimiento de #86, spec 20 y ADR-019/ADR-020. El responsable autorizó el plan,
dos buzones de proveedores distintos (direcciones excluidas de esta evidencia),
DNS en Acens, aplicación en `www.findly.barcelona` y creación puntual de roles
limitados con la sesión administrativa existente. #49 permanece abierta.

## Estado comprobado

- PR #97 integrada; sus pruebas efímeras no habilitaron SES ni prueban recepción.
- SES eu-west-1 permanece en sandbox: 200 mensajes/día, 1 por segundo;
  identidad creada por OIDC; acceso aún no solicitado mientras se valida DNS.
- Acens mantiene DNS/MX/SPF del dominio raíz. DMARC de observación se guardó
  en su panel: `v=DMARC1; p=none; adkim=r; aspf=r`; publicación comprobada
  en `ns11.servicio-online.net`. Los tres CNAME DKIM, MX/TXT MAIL FROM y
  CNAME ACM están guardados en Acens y comprobados sin recursión en los
  tres servidores autoritativos. Algunas respuestas negativas previas continúan
  en caché. La comprobación posterior confirmó identidad verificada y DKIM
  SUCCESS; MAIL FROM sigue PENDING.
- Entorno GitHub `production` creado, limitado a la rama `main`; variables
  públicas de cuenta, bucket existente y rol compartido configuradas.
- Rol `findly-shared-config` creado y corregido a confianza GitHub OIDC exacta.
  AWS Access Analyzer validó los permisos sin findings. El verificador
  `scripts/check-shared-config-permissions.mjs` pasó ocho comprobaciones AWS
  IAM Simulator: estado propio permitido; envío, IAM, estado de producción,
  borrado del estado y reetiquetado de certificados ajenos rechazados.
- La sesión raíz no puede asumir roles: AWS respondió que no se permite.
  No se ha aplicado Terraform ni desplegado recursos de correo/web como raíz.

## Validación y pendientes

La primera entrega añade el workflow manual compartido, comprobaciones previas
a credenciales y certificado reproducible. `npm run verify` completado:
lint, TypeScript, 469 tests, build, formato/validación/lint Terraform de las
siete raíces, contratos de hosting/correo, auditoría sin vulnerabilidades y
trazabilidad de diez requisitos. No constituyen aceptación AWS de correo.
La revisión de normas y spec corrigió el permiso de etiquetas ACM para exigir
propiedad previa además de las etiquetas solicitadas. La creación compuesta ACM con estas restricciones se ejecutó correctamente
desde GitHub en el bootstrap real.

Pendientes: validación MAIL FROM,
salida del sandbox, despliegue de producción, origen HTTPS,
recuperación/checkpoint/DLQ, feedback y supresión reales, borrado/caducidad,
recepción/apertura y cabeceras en ambos proveedores. No cerrar #98 ni #86.

## Preparación del stack de producción

La segunda entrega prepara `findly-production-deploy`, sin destrucción de
producción, y un límite obligatorio para roles de aplicación/Scheduler.
El rol y su límite se crearon con la sesión administrativa autorizada, tras
revisión y validación; los documentos desplegados coinciden con los revisados.
Ningún recurso del stack se ha desplegado todavía.
Los permisos demo generados antes/después de parametrizar su builder son
idénticos. AWS Access Analyzer no encontró errores ni advertencias de seguridad
en las cinco políticas y el límite; sugirió eliminar dos ARN de logs redundantes
heredados de demo. IAM Simulator pasó inicialmente nueve casos que comprueban creación de
roles con límite, rechazo sin él/con límite ajeno, imposibilidad de quitarlo o
modificarlo, protección del desplegador, aislamiento de estado y ausencia de
permisos de envío directo en el rol de despliegue.

El workflow original bloqueaba producción mientras SES/ACM/DNS no estaban listos.
La ampliación autorizada el 2026-10-05 separa web/backend de correo: certificado
obligatorio siempre, requisitos SES completos sólo al activar envío mediante
`enable_production_email=true`; por defecto la identidad y el remitente se pasan
vacíos y no se crean recursos ni rutas de correo. El despliegue real sigue
pendiente; esta preparación no demuestra publicación.
Las pruebas de esas condiciones, los roles y el wiring Terraform se validan
localmente; sus resultados se detallan en la validación al final de este documento. Estos controles
no acreditan creación del stack ni entrega; el rol AWS sí está configurado.

## Revisión y operación pendiente

PR #99 integrada con todos los checks verdes, incluido provision-test-destroy
AWS (run 37227517206). PR #100 se integró como usuario después de todos sus
checks, incluido provision-test-destroy AWS (run 37230626594). GitHub registró
el workflow y el bootstrap desde main terminó correctamente:
[run 37232209363](https://github.com/upc-malvaviscos/findly/actions/runs/37232209363).
Creó identidad SES eu-west-1 y certificado ACM us-east-1 con el rol compartido;
no se aplicó Terraform con raíz. El certificado ya está ISSUED y su ARN se configuró en GitHub production.
También se configuraron identidad verificada y remitente; su presencia no activa
el correo sin el input explícito del despliegue.
PR #101 integrada con todos los checks; el run 37235420505 pasó recorrido AWS
y destroy. El workflow de aceptación de correo quedó registrado y activo.

La revisión corrigió etiquetado de CloudFront, Cognito y API Gateway en
producción: modificar etiquetas exige propiedad existente. El permiso
CreateDistribution usa el recurso global requerido por AWS, separado del
etiquetado. La creación compuesta sigue pendiente de evidencia desplegada.
GetSubscriptionAttributes usa el topic exacto; su lectura desplegada queda
pendiente, porque IAM Simulator no modela correctamente ese recurso. Los nueve
casos IAM restantes pasan; no se amplía SNS para satisfacer el simulador.

La solicitud SES transaccional es manual y opcional, verifica primero identidad,
DKIM y MAIL FROM, y evita solicitudes pendientes repetidas. Describe de forma
explícita que web, feedback y pruebas de producción aún no están desplegados.
No incluye direcciones de prueba ni activa envíos.

Validación de la segunda entrega: `npm run verify` completado (505 tests,
TypeScript, build, lint/actionlint, siete raíces Terraform y contratos, auditoría
sin vulnerabilidades y sync). IAM Simulator completó 19 casos, incluidos
rechazo de etiquetado ajeno y creación CloudFront limitada por etiquetas.
Estos casos no acreditan el contexto de tag-on-create ni lectura SNS reales.

## Pruebas de aceptación preparadas

El responsable aprobó un operador temporal para datos sintéticos antes de
admitir tráfico real. El manifiesto privado identifica exactamente eventos,
claves DynamoDB, objetos y colecciones de una ejecución; caduca en seis horas.
Las políticas y confianza OIDC también caducan y no conceden IAM, envío SES
directo, escaneo DynamoDB, purga de colas ni borrado de versiones S3.
SES exige alcance regional para supresión: el harness limita las mutaciones a
una dirección ficticia propia del simulador y la retira durante limpieza.

El nuevo workflow manual comparte exclusión con despliegue, exige main,
responsable autorizado y confirmación de ausencia de tráfico. Las credenciales,
contraseña, JWT, capacidades y destinatarios se mantienen privados. La fase
sintética prepara API/idempotencia, estados durables de recuperación, DLQ,
feedback y supresión; no demuestra un crash original durante SendEmail ni una
carrera de borrado concurrente. La fase de buzones exige evidencia posterior
por proveedor de SPF/DKIM/DMARC, bandeja/spam y apertura antes de revocar enlaces.
La aceptación SES sola no cuenta como recepción.

El operador no se ha creado ni se han ejecutado estas pruebas en AWS: requieren
outputs reales de producción y un manifiesto nuevo. La limpieza elimina sólo
fixtures propias y espera la finalización del worker; una cancelación abrupta
puede exigir intervención. No publicar manifiestos, cuerpos de colas, buzones,
cabeceras completas ni URLs privadas. #86/#98/#49 permanecen abiertas.

Validación local de esta preparación: `npm run verify` pasó con 544 tests en
59 archivos, TypeScript, lint/actionlint, build, siete raíces Terraform, contratos
y auditoría sin vulnerabilidades. No equivale a ejecución de aceptación AWS.

AWS Access Analyzer validó las dos políticas del operador sin findings. Esto
valida documentos de permisos; el rol sigue sin crear y su uso desplegado
continúa pendiente.

IAM Simulator pasó seis casos del operador: datos propios permitidos; datos
ajenos, Scan, SendEmail directo, IAM y PurgeQueue rechazados. La revisión
reforzó presupuesto global, vigencia previa y limpieza selectiva de colas.

Captura del panel limitada a registros públicos, sin datos de sesión:

![Registros públicos SES y ACM guardados en Acens](assets/issue-98-acens-public-dns.png)

La comprobación real detectó que el transporte CLI por stdin no era portable.
Se sustituyó por SDK oficial con parámetros privados en memoria, allowlist y
timeouts; una consulta real STS confirmó el transporte sin mutaciones.

La revisión de limpieza conserva referencias y capacidades ante errores/404
de revocación, conserva fixtures si falla la desactivación del evento y aplica
un presupuesto de limpieza con reserva para finalizar el organizador temporal.
El preflight preparado exige 401 sin JWT para lectura y envío administrativos.
Estas comprobaciones aún requieren su ejecución contra producción.

## Publicación independiente del correo — 2026-10-05

El responsable autorizó publicar todo lo que no dependa de MAIL FROM.
El workflow separa `enable_production_email=false` de la validación HTTPS
obligatoria. Terraform omite el módulo de correo; el build AWS oculta el envío
y conserva acceso a las galerías. La activación explícita mantiene todos los
controles SES/DNS y exige identidad/remitente configurados. Se corrigió también
el dominio faltante en el workflow de aceptación, que exige correo habilitado.

Validación local completa: 555 pruebas unitarias, lint/typecheck/build, siete
raíces Terraform y contratos, auditoría sin vulnerabilidades y trazabilidad.
Las 21 pruebas de navegador pasan en Chromium, Firefox y WebKit.
La fixture activa explícitamente sus rutas de correo simulado.
Estos resultados no acreditan el despliegue ni entrega real de correo.
