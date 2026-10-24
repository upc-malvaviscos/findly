# Recuperación de acceso de organizadores

<!-- requirement: REQ-ADMIN-INVITATIONS -->

## Alcance implementado localmente

- Workflow manual deshabilitado por defecto hasta FINDLY_RECOVERY_ENABLED=true,
  sin destinatario arbitrario, limitado a cuatro operadores y
  al actor original de las reejecuciones.
- Mapeo privado GitHub → correo registrado; resuelve el usuario canónico en
  Cognito, rechaza cero/varios resultados y destinos compartidos. Comprueba que
  el correo no haya cambiado entre la búsqueda y la lectura del usuario.
- Lectura de estado y validación de pool/cuenta/región/rol temporal antes del
  envío. `FORCE_CHANGE_PASSWORD` usa RESEND; `CONFIRMED`/`RESET_REQUIRED` usan
  AdminResetUserPassword con correo verificado y recuperación por email.
- Formulario web ConfirmForgotPassword, sin sesión automática ni persistencia
  de código o contraseña. Conserva el flujo de primer acceso.
- Documentos IAM de mínimo privilegio generados sin aplicar AWS.
- Omisión explícita del entorno efímero por etiqueta y autor autorizado,
  solicitada por el responsable. No desactiva las pruebas locales ni CI.

## Validación

Resultados locales observados:

| Comprobación                            | Resultado                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run verify`                        | PASS: lint, actionlint, tipos, cobertura, build, Terraform, seguridad y trazabilidad |
| Suite inicial completa                  | 749 pruebas PASS; se añadió después el rechazo de recuperación deshabilitada         |
| Chromium, suite E2E completa            | 16 PASS, incluido primer acceso y confirmación del reset                             |
| `npm run test:floci:integration`        | 27 PASS con S3/DynamoDB emulados y Rekognition simulado                              |
| Playwright local con Floci, Chromium    | 7 PASS; contenedores y volúmenes eliminados al terminar                              |
| Auditoría de dependencias de producción | 0 vulnerabilidades tras actualizar Zod a 4.6.7                                       |

La auditoría original bloqueaba seguridad por GHSA-mrhx-c7xc-m3w5 en Zod 4.5.4.
La actualización conserva el resto del lockfile. Los validadores Terraform usan
proveedores simulados y copias temporales; no son planes ni applies contra AWS.
Persisten avisos de deprecación DynamoDB del proveedor, ajenos al cambio.

Terraform 1.14.0 y TFLint 0.61.0 se instalaron temporalmente con checksums
verificados. El wrapper npm de actionlint usa su release oficial 1.7.12, cuya
caché se preparó por el proxy con checksum porque su descarga directa fallaba.
El primer intento de E2E local falló por confianza TLS del proxy dentro del
contenedor; se repitió con un override temporal Compose que monta el almacén CA
read-only y configura NODE_EXTRA_CA_CERTS. No se desactivó la verificación TLS
ni se modificó Compose del repositorio. Sólo se ejecutó Chromium; no se afirma
validación Firefox/WebKit de esta entrega.

## Bloqueos operativos y trazabilidad remota

La creación de la issue fue rechazada tanto por el conector como por `gh issue
create`: HTTP 403 / `Resource not accessible by integration`. Crear la rama
remota mediante Git refs produjo el mismo error. No se ha publicado PR, no hay
checks remotos de esta entrega y no se afirma merge ni habilitación del workflow.
La nueva issue queda pendiente de permisos; el requisito existente conserva la
referencia histórica #105, sin afirmar que esa issue cubra la aceptación nueva.

El entorno no tiene identidad AWS ni acceso a variables/secrets del environment
de producción. No se ha comprobado ni aplicado el rol de recuperación, el mapeo
de los cuatro usuarios, la configuración efectiva de recuperación/email_verified
o la publicación web. Tampoco se han enviado invitaciones o códigos reales.

La acción se anunciará como lista sólo tras integrar, publicar la SPA y verificar
la configuración y una aceptación autorizada. Procedimiento:
[runbook de recuperación](../runbooks/organizer-recovery.md).

El responsable aportó los correos de los cuatro titulares. No se guardan en
archivos del repositorio ni se asume que sean el username Cognito; se utilizan
únicamente al configurar el secret privado del environment. La configuración
remota sigue bloqueada por los permisos de la integración.

## Instrucciones en la página de administración

El responsable pidió una guía paso a paso en la propia web. El login enlaza
a la acción de GitHub y explica cómo pulsar Run workflow sobre main, revisar el
correo más reciente y seguir la rama de contraseña temporal o código. El primer
acceso explica por qué pide una contraseña nueva y el formulario de recuperación
detalla qué introducir y cómo volver a iniciar sesión al terminar. No se
publican contactos ni se cambian permisos o envíos con esta edición de textos.

Verificación focal de los textos: 25 pruebas de autenticación/gateway/recuperación,
typecheck y build web correctos. Los E2E Chromium de primer acceso y recuperación
también pasan. La publicación sigue bloqueada por el HTTP 403 de GitHub; crear
la issue se volvió a intentar y fue rechazado.
