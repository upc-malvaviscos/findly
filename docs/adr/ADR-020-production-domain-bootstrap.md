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
