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

La publicación estuvo inicialmente bloqueada por HTTP 403 de la integración.
Tras aprobar su instalación en la organización propietaria, se creó la
[issue #175](https://github.com/upc-malvaviscos/findly/issues/175). La issue reúne los enlaces de rama, PR, ejecuciones remotas y resultado de
integración. La validación local no acredita por sí misma aceptación AWS. La referencia #105 corresponde al alta histórica,
no a la aceptación de esta recuperación.

La sesión cloud original no tenía identidad AWS ni acceso a variables/secrets
del environment de producción. No se comprobó ni aplicó el rol de recuperación, el mapeo
de los cuatro usuarios, la configuración efectiva de recuperación/email_verified
o la publicación web. Tampoco se han enviado invitaciones o códigos reales.

La acción se anunciará como lista sólo tras integrar, publicar la SPA y verificar
la configuración y una aceptación autorizada. Procedimiento:
[runbook de recuperación](../runbooks/organizer-recovery.md).

El responsable aportó los correos de los cuatro titulares. No se guardan en
archivos del repositorio ni se asume que sean el username Cognito; se utilizan
únicamente al configurar el secret privado del environment. La configuración
privada quedó pendiente en cloud; su uso efectivo desde la acción sigue pendiente.

## Instrucciones en la página de administración

El responsable pidió una guía paso a paso en la propia web. El login enlaza
a la acción de GitHub y explica cómo pulsar Run workflow sobre main, revisar el
correo más reciente y seguir la rama de contraseña temporal o código. El primer
acceso explica por qué pide una contraseña nueva y el formulario de recuperación
detalla qué introducir y cómo volver a iniciar sesión al terminar. No se
publican contactos ni se cambian permisos o envíos con esta edición de textos.

## Publicación limitada preparada — 2026-10-25

La CLI local confirma administración de anyulled y permisos write de los otros
tres actores. El environment organizer-recovery, inicialmente ausente, queda
configurado y releído: únicamente rama main, sin aprobación/espera externa,
cuenta/pool/rol esperados, secreto privado existente y activación en false.
El mapeo se extrajo fuera del repositorio, con permisos restringidos, y se
cifró por stdin mediante GitHub CLI; no se publica su contenido.

El responsable renovó la sesión local como raíz. Se utilizó exclusivamente
para consultas AWS de lectura; no se ejecutó con ella una recuperación ni se
modificó AWS. El trust del rol dedicado coincide exactamente con el generador,
su única política inline también y no hay políticas adjuntas. Esto verifica
los documentos IAM desplegados, no una asunción OIDC efectiva desde Actions.

El configurador privado comprueba pool, remitente, recuperación por correo,
contacto sin cambios, unicidad y ausencia de MFA de correo incompatible. El
resultado real, sin contactos ni nombres Cognito, es:

| Actor GitHub | Estado Cognito        | Correo verificado | Prerrequisitos |
| ------------ | --------------------- | ----------------- | -------------- |
| anyulled     | CONFIRMED             | true              | OK             |
| orLuzuriaga  | FORCE_CHANGE_PASSWORD | true              | OK             |
| raati5674    | CONFIRMED             | true              | OK             |
| surinyach    | FORCE_CHANGE_PASSWORD | true              | OK             |

El login público continúa sirviendo la web anterior, sin formulario de código.
Su bundle coincide con el registrado por el despliegue 38808198446. Se registra
su hash SHA-256, sin fijar su nombre, como predecesor permitido para evitar que
una reejecución posterior sustituya otra versión de la web.

La lectura real del estado, seleccionando sólo outputs públicos en memoria,
confirma los destinos API/cliente Cognito y CloudFront activo con origen S3
privado esperado. El output de API incluye una barra final; se conserva para
el build y se comparan ambas formas de la raíz al consultar API Gateway. La
prueba focal cubre este caso. Estas lecturas como raíz no acreditan permisos
efectivos del rol de despliegue; los comprobará el workflow usando OIDC.

El responsable aprueba la publicación limitada descrita en ADR-025. Se añade
un workflow manual de producción, sin Terraform ni ampliaciones de permisos,
que compone los commits fijados de la web anterior y la recuperación de #176.
Las fuentes ajenas a los cinco archivos de autenticación proceden del commit
desplegado anterior. El artefacto incluye sus hashes; no incorpora los nuevos
controles de fotos/eventos de main ni modifica su código en el repositorio.

Comprobaciones focales observadas:

- Cinco pruebas locales de autorización, outputs públicos, rechazo de destinos
  incorrectos y composición byte a byte pasan.
- TypeScript del repositorio y de las fuentes compuestas pasa.
- Chromium sobre el artefacto compuesto: tres E2E pasan, para primer acceso,
  confirmación de código y conservación del correo de galerías sin añadir los
  controles administrativos pendientes. Cognito/API están simulados.
- ESLint de los scripts/tests nuevos y actionlint de todos los workflows pasan.
- `npm run verify`: suite completa, lint, tipos, build, validaciones Terraform
  aisladas, auditoría de producción sin vulnerabilidades y trazabilidad pasan.
- `npm run test:e2e -- --project=chromium`: 16 pruebas habituales pasan, incluida
  la subida actual de main; la prueba exclusiva de composición tiene su propia
  configuración y no se ejecuta contra el frontend completo.

Al terminar la preparación, la publicación real, los permisos OIDC efectivos, la recepción y el login
seguían pendientes. Hasta ese momento no se habían ejecutado Deployment,
Terraform apply, AWS efímero ni envíos de recuperación. No se acredita la
recuperación operativa con esta validación local. La issue #175 permanece abierta.

Verificación focal de los textos: 25 pruebas de autenticación/gateway/recuperación,
typecheck y build web correctos. Los E2E Chromium de primer acceso y recuperación
también pasan. La publicación estuvo bloqueada por HTTP 403 de GitHub y se reanudó tras
aprobar la instalación de la organización. La issue de seguimiento es #175.

## Publicación real y habilitación — 2026-10-25

La [PR #177](https://github.com/upc-malvaviscos/findly/pull/177) se integró por
rebase mediante el ruleset, con CI, CodeQL y todos los checks requeridos
correctos, en `a3cbd6300d2e160c114108557e0baeaa6d329b07`.
CI: [40144294661](https://github.com/upc-malvaviscos/findly/actions/runs/40144294661).
El [job efímero](https://github.com/upc-malvaviscos/findly/actions/runs/40144294834)
terminó correctamente con OIDC, provisión y destroy omitidos; no desplegó AWS.

La [publicación limitada 40144592272](https://github.com/upc-malvaviscos/findly/actions/runs/40144592272)
terminó SUCCESS sobre ese commit. Obtuvo OIDC como findly-production-deploy,
contrastó destinos reales, compiló la composición aprobada, publicó assets,
index y manifiesto en S3, invalidó CloudFront y esperó su finalización.
La comprobación posterior comparó bytes de CDN/rutas con el build y abrió el
formulario de código, volviendo al login sin autenticar ni enviar mensajes.
Una lectura independiente del manifiesto público confirmó ambos commits,
cinco archivos de autenticación, ejecución AWS y correo de galerías habilitado.
No ejecutó Terraform ni modificó IAM, Cognito, fotos o backfill.

Se releyeron los prerrequisitos de las cuatro cuentas, todos correctos, y se
configuró/releyó FINDLY_RECOVERY_ENABLED=true. El environment sólo admite main
y no exige revisores ni espera externa. El titular ejecuta su propia acción;
no depende del responsable para aprobar cada solicitud.

El responsable aclara que anyulled no necesita recuperación. El destinatario
que necesita primer acceso es Santi, identificado mediante su perfil GitHub
público como surinyach, con FORCE_CHANGE_PASSWORD y correo verificado. La
acción resolverá su usuario canónico y solicitará RESEND sólo cuando él la
ejecute con su cuenta. No se ejecutó recuperación de anyulled ni se suplantó
el actor de Santi. No se han enviado mensajes a compañeros desde esta sesión.

La asunción OIDC del rol de recuperación, la aceptación del envío por Cognito,
la recepción y el login quedan pendientes de la primera ejecución real del
titular. La asunción del rol de despliegue y la web publicada no prueban estos
resultados. Se mantiene #175 abierta; no se fuerza un reset innecesario para
completar una prueba y no se anuncia recepción o acceso como verificados.
