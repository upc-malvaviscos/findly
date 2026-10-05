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

## Límites de aceptación

Las invitaciones usan el mensaje y envío predeterminados de Cognito
(`COGNITO_DEFAULT`), independientes del correo de galerías SES. AWS rechazó en
la primera aceptación la plantilla personalizada con esta modalidad de envío;
la corrección aprobada es conservar el mensaje estándar y comunicar el enlace
al login por separado. No se amplían permisos IAM ni se cambia el remitente de
Cognito a la identidad SES de Findly en esta decisión. La aceptación AWS usa `SUPPRESS` y datos sintéticos;
comprueba autenticación, rechazo de autorregistro y limpieza, no entrega real.

Se conserva la administración completa para todas las cuentas autorizadas; no
se añaden grupos, jerarquías o una ruta pública para crear administradores.
No se guardan contraseñas definitivas en Terraform, scripts, Git o logs.

Referencias: [spec 04](../../specs/04-admin-event-management-and-cognito-authorization.md),
[issue #105](https://github.com/upc-malvaviscos/findly/issues/105) y
[runbook](../runbooks/admin-invitations.md).
