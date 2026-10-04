# ADR-020: dominio de producción y configuración compartida por OIDC

Estado: aprobado por el responsable el 2026-10-04; configuración en curso, sin
despliegue de producción ni aceptación de entregabilidad todavía.

## Decisión

La aplicación y sus galerías usarán `https://www.findly.barcelona`. Acens sigue
gestionando los DNS. El remitente es `info@findly.barcelona`; SES eu-west-1 usa
la identidad compartida `findly.barcelona` y MAIL FROM `bounce.findly.barcelona`.
El MX/SPF de recepción del dominio raíz se conserva. DMARC inicial observa
con `p=none`, según ADR-019; no se crea un buzón de respuestas mediante SES.

El certificado público ACM de `www.findly.barcelona` reside en us-east-1 por
CloudFront. Su estado separado es `findly/shared/web-certificate/terraform.tfstate`;
la identidad conserva `findly/shared/email-identity/terraform.tfstate`. Ambos
recursos tienen `prevent_destroy`, etiquetas y estado cifrado/versionado.

El responsable autorizó puntualmente la sesión raíz existente para crear los
roles limitados. AWS impide asumir roles desde raíz. El rol `findly-shared-config`
se usa exclusivamente por GitHub OIDC: repositorio exacto, audience STS y
environment `production`, que permite únicamente `main`. El workflow manual
comprueba los cuatro responsables de ADR-017 y el actor de reejecución antes
de conceder credenciales, también si sólo se reejecuta el job de configuración.

El rol permite gestionar esa identidad, solicitar el certificado con DNS y
nombre exacto, y operar únicamente sus dos estados/lockfiles. No envía correo,
administra IAM ni borra identidades, certificados o estados. La creación del
certificado requiere ARN aún desconocido; se limita por dominio, región y tags.
La solicitud de salida del sandbox es regional y no activa el módulo por sí sola.

## Despliegue de producción preparado

El rol `findly-production-deploy` conserva el aislamiento de ADR-017, con
namespace/buckets/estado propios y sin rol de destrucción de producción.
La generación de políticas parametriza el entorno; se comprobó que la salida
de las políticas demo no cambia. La preparación inicial sólo crea API/web
para revisar y fijar los IDs exactos de API/OAC antes de mutar sus hijos.
La autorización inicial de tags API, sin contexto ApiName en AWS, exige tags
Findly/production y eu-west-1; las mutaciones posteriores usan IDs exactos.
CloudFront requiere crear OAC con recurso global por limitación de AWS; tras
crear la distribución, el binding verifica tags, cuenta, bucket y OAC exactos.

Los roles Lambda/Scheduler de producción reciben la política límite
`findly-production-runtime-boundary`: sólo operaciones de aplicación en recursos
del namespace de producción, correo desde el remitente acordado y consulta de
supresión regional. La política no concede permisos por sí sola; cada función
conserva además su política específica mínima. El desplegador no puede crear
roles sin ese límite, retirarlo, modificarlo ni modificar su propio rol.
Demo y CI efímero conservan su configuración vigente.

El workflow rechaza rama, actor original, actor de reejecución, backend, cuenta
o buckets distintos antes de credenciales. Tras OIDC comprueba identidad SES,
DKIM, MAIL FROM, SPF/DMARC públicos, salida del sandbox, estado de envío/cuotas
y certificado ACM emitido. Después de publicar comprueba HTTPS y `/gallery`.
Esto no sustituye recuperación/feedback ni recepción/apertura de un enlace real.

## Secuencia y límites

1. Integrar por PR la configuración reproducible y ejecutar el workflow manual.
2. Añadir los registros públicos generados en Acens y comprobar SES/ACM.
3. Solicitar salida del sandbox y comprobar aprobación/cuotas regionales.
4. Preparar el rol de despliegue, publicar producción por OIDC y verificar
   HTTPS y los permisos desplegados; no desplegar el stack con raíz.
5. Probar recuperación/feedback AWS y recepción/apertura en los dos buzones
   autorizados, sin publicar sus direcciones ni enlaces privados.

El paso 4 requiere correo configurado. La issue #98 y #86 permanecen abiertas
hasta verificar todos sus criterios; #49 permanece abierta por instrucción del
responsable. Los tests locales, el bootstrap y la integración de código no
acreditan recepción real. Mantener privacidad, consentimiento, revocación,
retención y supresión de ADR-019. Sin servicios de coste fijo ni DNS en Route53.
