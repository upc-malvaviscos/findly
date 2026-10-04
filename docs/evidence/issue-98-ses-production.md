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
  identidad propia inexistente antes del bootstrap, acceso aún no solicitado.
- Acens mantiene DNS/MX/SPF del dominio raíz. DMARC de observación se guardó
  en su panel: `v=DMARC1; p=none; adkim=r; aspf=r`; publicación comprobada
  en `ns11.servicio-online.net`. DKIM/MAIL FROM aún pendientes.
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
propiedad previa además de las etiquetas solicitadas. La operación compuesta
de creación/etiquetado queda pendiente de su ejecución real desde GitHub.

Pendientes: ejecutar bootstrap desde main, DNS/DKIM/SPF/DMARC, certificado
emitido, salida del sandbox, rol y despliegue de producción, origen HTTPS,
recuperación/checkpoint/DLQ, feedback y supresión reales, borrado/caducidad,
recepción/apertura y cabeceras en ambos proveedores. No cerrar #98 ni #86.

## Preparación del stack de producción

La segunda entrega prepara `findly-production-deploy`, sin destrucción de
producción, y un límite obligatorio para roles de aplicación/Scheduler.
La sesión administrativa sólo genera documentos de permisos hasta completar
la revisión y validación; ningún recurso del stack se ha desplegado todavía.
Los permisos demo generados antes/después de parametrizar su builder son
idénticos. AWS Access Analyzer no encontró errores ni advertencias de seguridad
en las cinco políticas y el límite; sugirió eliminar dos ARN de logs redundantes
heredados de demo. IAM Simulator pasó inicialmente nueve casos que comprueban creación de
roles con límite, rechazo sin él/con límite ajeno, imposibilidad de quitarlo o
modificarlo, protección del desplegador, aislamiento de estado y ausencia de
permisos de envío directo en el rol de despliegue.

El workflow preparado bloquea producción mientras SES/ACM/DNS no estén listos.
Las pruebas de esas condiciones, los roles y el wiring Terraform se validan
localmente; sus resultados se detallan en la validación al final de este documento. Estos controles
no acreditan creación real ni entrega, y la configuración AWS sigue pendiente.

## Revisión y operación pendiente

PR #99 integrada con todos los checks verdes, incluido provision-test-destroy
AWS (run 37227517206). GitHub todavía no registra el nuevo workflow: tanto
la consulta como el dispatch directo por filename responden 404, aunque el
archivo existe en main. La siguiente PR se integrará como usuario tras sus
checks para comprobar de nuevo el registro; no se relajan main/OIDC ni se
despliega con la sesión raíz.

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
