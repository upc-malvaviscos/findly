# Invitaciones de administradores

Terraform gestiona el pool `findly-production-organizers` y su cliente. Las
cuentas y sus contraseñas quedan fuera de Terraform y de su estado. Cada cuenta
de ese pool dispone del acceso administrativo completo; no hay grupos ni niveles
de permisos de negocio. Invita únicamente a organizadores autorizados.

## Requisitos operativos

- Usa una sesión AWS temporal, no raíz, con caducidad conocida por el proveedor
  de credenciales del SDK. Una sesión temporal de un perfil autorizado cumple
  este requisito. Credenciales estáticas, caducadas o sin caducidad identificable
  se rechazan; exportar solamente un token de sesión no demuestra su caducidad.
- La identidad debe disponer ya de `cognito-idp:DescribeUserPool` y
  `cognito-idp:AdminCreateUser` sobre el pool autorizado. La herramienta no crea
  identidades ni modifica IAM. Si faltan permisos, detente y revisa con el
  responsable; no utilices la sesión raíz.
- Configura `FINDLY_AWS_ACCOUNT_ID` y `FINDLY_COGNITO_USER_POOL_ID` con la cuenta
  y el ID del pool de producción revisados. La región es `eu-west-1`.
- El pool debe tener nombre, ARN y etiquetas de producción Terraform correctos,
  altas únicamente administrativas y correo `COGNITO_DEFAULT`. La invitación
  usa el correo gestionado por Cognito, independiente del envío de galerías SES.
  Sus límites de envío pueden impedir una invitación; no se afirma entrega
  desde la respuesta de la API.
- Ejecuta desde el repositorio con Node 24 y sus dependencias instaladas. No
  pongas contactos, contraseñas o credenciales en argumentos, Git ni registros
  compartidos. No uses una terminal cuya entrada se registre públicamente.

## Validar sin enviar

```sh
node scripts/invite-admin.mjs
```

Introduce el nombre de usuario exacto y el correo cuando se soliciten por la
entrada estándar. La herramienta verifica la sesión, la cuenta y el pool sin
crear ni modificar usuarios. Un resultado correcto no demuestra que el nombre
esté disponible ni que un correo se vaya a entregar.

## Enviar una invitación autorizada

Tras obtener autorización explícita para el destinatario y el envío real:

```sh
node scripts/invite-admin.mjs --send
```

Cognito genera la contraseña temporal y solicita su entrega por correo. La
herramienta no establece una contraseña, no devuelve datos de contacto ni la
respuesta del usuario, no marca `email_verified` y no añade grupos. Conserva
las cuentas existentes: un nombre ya existente falla sin modificarlo ni
reenviar una invitación. Ante un fallo de red o respuesta incierta, revisa
Cognito antes de repetir; la herramienta no reintenta el envío automáticamente.

El invitado abre `https://www.findly.barcelona/admin/login`, introduce su nombre
de usuario y contraseña temporal y elige una contraseña definitiva en su primer
acceso. La nueva contraseña debe cumplir la política del pool: mínimo doce
caracteres, mayúsculas, minúsculas, números y símbolos. Las sesiones y el desafío
pendiente permanecen en memoria de la web.

La prueba unitaria `tests/infra/admin-invitations.test.ts` usa AWS simulado:
valida aislamiento, rechazo de raíz/credenciales estáticas, configuración del
pool, preservación de usuarios y petición exacta de invitación. No envía correos
ni acredita permisos desplegados o entrega real. La aceptación AWS sintética
con `SUPPRESS` tampoco acredita recepción de una invitación real.
