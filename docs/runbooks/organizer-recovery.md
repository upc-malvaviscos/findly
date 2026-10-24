# Recuperar mi acceso a Findly

La acción prevista es [Recuperar mi acceso a Findly](https://github.com/upc-malvaviscos/findly/actions/workflows/recover-organizer.yml).
Sólo estará disponible después de integrar el workflow y completar los requisitos
operativos siguientes. Este enlace no acredita que esté habilitada.

## Uso por el organizador

1. Abrir la acción y pulsar **Run workflow** sobre `main`, con la misma cuenta
   GitHub asociada al usuario de Findly. No se introduce un correo ni un usuario.
2. Si aún falta el primer acceso (`FORCE_CHANGE_PASSWORD`), Cognito reenvía la
   invitación con una nueva contraseña temporal al correo registrado. Abrir
   <https://www.findly.barcelona/admin/login>, iniciar sesión y elegir contraseña.
3. Si la cuenta está `CONFIRMED` o `RESET_REQUIRED`, Cognito envía un código de
   recuperación al correo verificado. En el login, elegir **Ya tengo un código de
   recuperación**, introducir el usuario de Findly, código y nueva contraseña.
   Tras guardar, iniciar sesión normalmente; completar el reset no autentica.

Cognito informa del estado de la cuenta, no de si alguien recuerda su contraseña.
Una petición de reset invalida la contraseña anterior. Si la API acepta el envío,
eso no confirma la recepción. Revisar Cognito antes de reintentar ante una
respuesta incierta; no se reenvía automáticamente.

Una cuenta inexistente, deshabilitada, federada o con estado no admitido falla
sin solicitar envío. No se crea una cuenta nueva ni se cambia su correo. Para
recuperar una cuenta confirmada se exige correo verificado, recuperación por
email y ausencia de MFA de correo incompatible. No se marca `email_verified`
automáticamente: el operador debe verificar previamente la titularidad mediante
el procedimiento autorizado. La primera invitación sí admite un correo aún no
verificado, como la herramienta existente de invitaciones.

## Configuración operativa necesaria

Una persona autorizada debe completar y comprobar lo siguiente, sin almacenar
contactos o credenciales en Git:

- Crear el environment GitHub `organizer-recovery`, restringido a `main`.
  No exigir un revisor externo en cada ejecución si se quiere autoservicio.
- Configurar sus variables `FINDLY_AWS_ACCOUNT_ID`,
  `FINDLY_COGNITO_USER_POOL_ID` y `FINDLY_RECOVERY_ROLE_ARN`.
- El rol se llama `findly-organizer-recovery`. El generador siguiente produce
  únicamente sus documentos IAM, sin llamadas ni cambios AWS:

  ```sh
  node scripts/print-organizer-recovery-role.mjs
  ```

  Lee la cuenta y el pool de las dos primeras variables. Revisar y aplicar los
  documentos desde una sesión operativa autorizada. El trust sólo acepta el
  audience STS y el subject del environment de este repositorio. El rol sólo
  puede describir el pool, buscar y consultar usuarios, reenviar invitaciones y solicitar
  resets en ese pool. No tiene permisos de despliegue, SES, borrado ni edición de
  atributos. `AdminCreateUser` no distingue crear/reenviar en IAM; la barrera de
  aplicación consulta primero una cuenta existente y usa exclusivamente RESEND.

- Guardar en el secret del environment `FINDLY_ORGANIZER_ACCOUNTS` un objeto JSON
  GitHub → correo registrado. Claves autorizadas: `anyulled`, `orLuzuriaga`,
  `raati5674`, `surinyach`. Cada valor es el correo registrado del titular. La
  acción busca el usuario canónico y rechaza cero o varios resultados, revisando
  todas las páginas. Vuelve a comprobar el correo antes de enviar; no lo cambia.
  No usar correos como inputs públicos ni guardarlos en Git.
- Los cuatro necesitan permiso de escritura en el repositorio para el dispatch.
  Sólo el actor original puede reejecutar su solicitud. Se comprueban rama,
  repositorio, actor, mapeo y rol antes de obtener credenciales y antes del envío.
- El SDK recibe la caducidad de STS mediante `AWS_CREDENTIAL_EXPIRATION`; no se
  aceptan credenciales estáticas ni sesiones sin caducidad identificable.
- Aplicar de forma revisada la configuración Cognito de recuperación por
  `verified_email` y publicar la SPA con el formulario de confirmación de código.
  No habilitar el envío de códigos antes de que ese formulario esté disponible.
- Sólo tras comprobar la SPA publicada, el rol, el mapeo y los correos, poner
  `FINDLY_RECOVERY_ENABLED=true` en las variables del environment. Mientras no
  esté habilitada explícitamente, la herramienta falla antes de obtener credenciales.
- Verificar remitente Cognito/SES y correo verificado de cada usuario confirmado.
  Conservar el remitente de ADR-021 y no ampliar trust de otros roles.

La configuración no autoriza crear usuarios inexistentes. Un usuario ausente se
gestiona mediante el [procedimiento de alta](admin-invitations.md).

## Pruebas y operación

### Publicar únicamente la recuperación

Tras integrar la PR correspondiente, el workflow manual
`publish-organizer-recovery.yml` publica la composición aprobada en ADR-025.
Ejecutarlo sólo desde main con una de las cuatro identidades autorizadas.
Usa el environment production y el rol existente; requiere sus variables
FINDLY_AWS_ACCOUNT_ID, AWS_TERRAFORM_STATE_BUCKET y AWS_DEPLOY_ROLE_ARN.
No utiliza las variables de bucket ausentes: obtiene los destinos del estado
desplegado y los contrasta con API, Cognito y CloudFront mediante lecturas AWS.
El rol debe disponer ya de esos permisos; un AccessDenied detiene el flujo,
sin ampliar políticas ni cambiar de identidad.

El artefacto contiene la web del despliegue correcto 38808198446 y únicamente
los cinco archivos de autenticación de #176, con sus dependencias bloqueadas.
El manifiesto público recovery-release.json registra los commits y hashes.
El build conserva el correo de galerías habilitado y rechaza deriva de
dependencias. No publica los controles posteriores de edición/borrado ni el
nuevo contrato de subida; no cambia su implementación en main.

Validación local del artefacto, sin llamadas AWS ni envíos:

```sh
npm ci
npm run test:recovery-web
```

La prueba compila las fuentes compuestas, comprueba tipos y ejecuta Chromium
con respuestas simuladas de Cognito/API. CI la ejecuta además de sus suites
habituales. No sustituye la aceptación en producción.

El workflow no llama a Terraform. Publica en S3 sin borrar assets anteriores,
rechaza sustituir una web que no coincida con el hash del predecesor comprobado
o con el nuevo artefacto idéntico,
conserva el index previo como artefacto del runner, invalida CloudFront y espera
su finalización. Después compara los bytes servidos con el build y abre el
formulario de código en el navegador sin introducir datos. Ante un fallo tras
una escritura, inspeccionar el estado antes de reintentar; no hay rollback
automático. No ejecutar Deployment para publicar únicamente este formulario.

La publicación no activa la recuperación ni prueba los endpoints de fotos del
backend parcialmente aplicado. Requiere igualmente las cuentas elegibles,
el mapeo privado y la aceptación de recepción/login antes de anunciarla lista.
Véase [ADR-025](../adr/ADR-025-limited-organizer-recovery-publication.md).

Las pruebas unitarias y E2E simulan AWS. No prueban permisos IAM desplegados,
entrega real de correo ni configuración efectiva del pool. Antes de anunciar la
acción como lista, comprobar cada prerrequisito y hacer una aceptación autorizada
por su titular, sin publicar el correo, código ni contraseña.

Para esta entrega el responsable pidió expresamente no lanzar el entorno AWS
efímero. La PR debe crearse con el sufijo de título `[skip-ephemeral-approved]` y autor
de la lista autorizada, para que el evento inicial ya omita AWS. También se admite
la etiqueta `skip-ephemeral-approved`, pero añadirla después de abrir la PR no
impide que la ejecución inicial ya haya empezado. El job requerido conserva su resultado y explica el salto;
los checks normales siguen ejecutándose. No se acredita aceptación AWS con ello.

El secret, las variables y el rol son externos al merge. La creación del rol,
el deploy del pool y la publicación de la SPA requieren acceso operativo. El
[informe de evidencia](../evidence/organizer-recovery.md) registra sus pendientes.
