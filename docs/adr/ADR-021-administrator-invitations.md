# ADR-021: altas administrativas por invitación Cognito

## Decisión aprobada

Las cuentas del pool de organizadores conceden acceso administrativo completo;
por tanto, el pool sólo admite altas administrativas y no autorregistro.
Terraform gestiona pool, cliente y política, conservando las cuentas existentes.
Se utiliza la invitación estándar de Cognito, sin plantilla personalizada. El
operador comunica por separado el enlace de acceso del entorno. Los nombres de
producción son estables; el número de PR identifica únicamente stacks sintéticos
temporales según ADR-008.

Un operador con sesión AWS temporal no raíz ejecuta una herramienta que valida
cuenta, región y pool antes de solicitar una invitación con envío explícito.
Cognito genera la contraseña temporal; cuentas, correos y contraseñas no forman
parte del estado Terraform. La herramienta no amplía IAM ni usa raíz como
alternativa cuando falta permiso. La identidad operativa debe existir y tener
los permisos mínimos descritos en el runbook antes de un envío real.

El gateway web devuelve una sesión autenticada o un challenge pendiente de
`NEW_PASSWORD_REQUIRED`. El contexto conserva el challenge exclusivamente en
memoria durante tres minutos; el primer acceso permite definir contraseña
definitiva. Cancelar, caducar o cerrar sesión invalida las respuestas antiguas.
La política actual exige 12 caracteres y la contraseña temporal dura siete días.

## Actualización aprobada — 2026-10-15

El responsable decide conservar la configuración SES existente en producción:
`DEVELOPER`, identidad `findly.barcelona` de la misma cuenta en eu-west-1 y
remitente `info@findly.barcelona`. Terraform la declara explícitamente en el
root de producción y la conserva incluso con correo de galerías desactivado.
La plantilla sigue siendo la estándar de Cognito y el login se comunica por
separado; no se añaden SMS ni plantillas personalizadas. El rol vinculado de
Cognito para SES ya existe; no se amplían permisos del operador ni de GitHub.
Sandbox/demo/PR mantienen `COGNITO_DEFAULT` por defecto.

La herramienta de invitación reconoce únicamente el remitente estándar o esa
identidad SES exacta; rechaza cuentas, regiones, dominios y remitentes ajenos.
Esta actualización no autoriza una invitación administrativa nueva ni acredita
su recepción. La autorización de pruebas actual corresponde a galerías (#98).

## Límites de aceptación originales

Las invitaciones usan el mensaje y envío predeterminados de Cognito
(`COGNITO_DEFAULT`), independientes del correo de galerías SES. La primera
aceptación falló por un campo SMS vacío en la plantilla; además, la documentación
de AWS exige SES para personalizar el correo. La corrección aprobada conserva el
mensaje estándar y comunica el enlace al login por separado, sin configurar SMS.
No se amplían permisos IAM ni se cambia el remitente de Cognito a la identidad
SES de Findly. La aceptación AWS usa `SUPPRESS` y datos sintéticos;
comprueba autenticación, rechazo de autorregistro y limpieza, no entrega real.

Se conserva la administración completa para todas las cuentas autorizadas; no
se añaden grupos, jerarquías o una ruta pública para crear administradores.
No se guardan contraseñas definitivas en Terraform, scripts, Git o logs.

Referencias: [spec 04](../../specs/04-admin-event-management-and-cognito-authorization.md),
[issue #105](https://github.com/upc-malvaviscos/findly/issues/105) y
[runbook](../runbooks/admin-invitations.md).

## Recuperación autoservicio de cuentas existentes

El responsable solicita separar el alta de la recuperación de los cuatro
operadores. El workflow manual asocia al actor con su cuenta de forma privada
y usa el estado Cognito: RESEND para primer acceso pendiente y reset por código
para cuentas confirmadas. El rol dedicado sólo actúa sobre el pool de producción,
sin permisos de despliegue ni edición de atributos. El correo confirmado debe
estar verificado; nunca se verifica por conveniencia del script. La recuperación
requiere publicar el formulario ConfirmForgotPassword y configurar el environment
y rol antes de habilitar su uso. Los detalles y límites están en el
[runbook de recuperación](../runbooks/organizer-recovery.md). No cambia la política
de invitaciones nuevas ni concede acceso a cuentas no existentes.
