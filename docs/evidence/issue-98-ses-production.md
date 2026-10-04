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
  en su panel: `v=DMARC1; p=none; adkim=r; aspf=r`; publicación DNS pendiente
  en la última consulta al servidor autoritativo. DKIM/MAIL FROM aún pendientes.
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
