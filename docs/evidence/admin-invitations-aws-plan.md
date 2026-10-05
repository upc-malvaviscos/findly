# Aceptación AWS de invitaciones administrativas

<!-- requirement: REQ-ADMIN-AUTH -->
<!-- requirement: REQ-ADMIN-INVITATIONS -->

## Configuración reproducible

Terraform configura `allow_admin_create_user_only = true` sobre el pool existente,
con una plantilla de invitación que conserva `{username}` y `{####}` y apunta a
`/admin/login` en el origen del entorno. Mantiene el nombre y el cliente del pool,
la política de contraseña de 12 caracteres y exige completar el cambio de
contraseña temporal dentro de siete días. El cliente fija una sesión de challenge
de tres minutos. Las cuentas y contraseñas personales
no se gestionan con Terraform.

## Prueba sintética desplegada

El workflow OIDC de PR ejecuta `scripts/check-admin-invitation-aws.mjs` después de
provisionar el entorno. El runner acepta únicamente pools `findly-pr-N-organizers`
en `eu-west-1`, con etiquetas de entorno PR, `DataClass=synthetic`,
`Ephemeral=true` y `ManagedBy=Terraform`, pertenecientes a la cuenta de la sesión
asumida. Rechaza credenciales raíz y destinos de producción.

La prueba crea un usuario sintético con `MessageAction=SUPPRESS`, verifica
`FORCE_CHANGE_PASSWORD`, completa `NEW_PASSWORD_REQUIRED` mediante Cognito real y
comprueba un login posterior con la contraseña definitiva. Verifica además que
`SignUp` rechaza el autorregistro. Las contraseñas, sesiones y tokens sólo viven
en memoria: no se pasan como argumentos, se imprimen ni se escriben en archivos.

La limpieza intenta eliminar las dos identidades sintéticas únicas incluso si
la creación o el autorregistro fallaron después de escribir en AWS. Un fallo de
limpieza hace fallar la prueba; el workflow conserva además su `destroy` final.
La prueba usa los permisos existentes, sin ampliar roles IAM.

## Evidencia y límites

Las pruebas unitarias del runner validan barreras, redacción y limpieza con
respuestas simuladas: no son aceptación AWS. La ejecución real sólo queda
acreditada por el run de la PR que provisiona, prueba y destruye el entorno.
Hasta registrar ese run, la aceptación desplegada permanece pendiente.

`SUPPRESS` impide enviar invitaciones: esta prueba no demuestra la entrega real.
Una invitación real requiere un destinatario autorizado explícitamente, una
sesión operativa temporal permitida y revisar los límites de envío de Cognito.
Tampoco despliega cambios de producción ni modifica los usuarios existentes.

## Referencias

- [AWS: configuración de creación administrativa](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminCreateUserConfigType.html).
- [AWS: creación de usuarios e invitaciones](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminCreateUser.html).
- [AWS: respuesta al challenge de autenticación](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_RespondToAuthChallenge.html).

## Implementación local de #105

La web diferencia sesión autenticada y challenge pendiente, muestra el formulario
para elegir contraseña definitiva y mantiene secretos sólo en memoria. Las
pruebas cubren cancelación, caducidad y peticiones antiguas que terminan después
de un nuevo login. Los errores mostrados no revelan datos de la respuesta AWS.
La herramienta invita únicamente con `--send`; el modo predeterminado valida.
Las 52 pruebas focales pasaron; typecheck, ESLint y validación Terraform local
pasaron. Playwright verificó 24 casos en Chromium, Firefox y WebKit, incluido
el primer acceso con Cognito simulado. La aceptación remota sigue pendiente.

La primera validación completa de la rama (pre-push) pasó con 600 pruebas,
lint, typecheck, build, siete raíces Terraform, contratos, auditoría sin
vulnerabilidades y trazabilidad. La revisión independiente de estándares y del
plan no encontró bloqueantes. Se reforzó después el rechazo de correos con
puntos iniciales/finales o consecutivos, con tres casos adicionales; el siguiente
pre-push vuelve a comprobar la versión final antes de publicarla.
