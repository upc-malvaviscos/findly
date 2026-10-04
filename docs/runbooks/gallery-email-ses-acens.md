# Correo de galerías: SES y DNS en Acens

## Configuración acordada y estado

Issue #86, ADR-019. Remitente: `Findly <info@findly.barcelona>` (nombre visible
opcional); identidad regional `findly.barcelona` en eu-west-1;
MAIL FROM `bounce.findly.barcelona`; DNS en Acens.
Implementación preparada, configuración externa y recepción real pendientes.
La compra del dominio no verifica SES ni activa acceso de producción.

Este runbook no constituye autorización para crear recursos, modificar DNS o
enviar correos. Revisar el plan y los permisos y obtener autorización para esas
acciones antes de ejecutarlas. La issue #49 permanece abierta.

## Identidad compartida

Usar el bucket remoto de estado existente, cifrado/versionado y con lockfile;
no crear identidad dentro de un entorno que se destruya habitualmente.

```sh
terraform -chdir=infra/email-identity init \
  -backend-config="bucket=$FINDLY_TERRAFORM_STATE_BUCKET" \
  -backend-config="key=findly/shared/email-identity/terraform.tfstate" \
  -backend-config="region=eu-west-1" \
  -backend-config="encrypt=true" \
  -backend-config="use_lockfile=true"
terraform -chdir=infra/email-identity plan
```

Aplicar únicamente tras autorización; `prevent_destroy` protege la identidad.
Los outputs `dkim_records` y `mail_from_records` contienen exclusivamente
registros DNS públicos. El ARN de identidad alimenta `email_identity_arn` del
entorno seleccionado; no copiar estado, credenciales ni outputs privados a Git.

## DNS en Acens

En [panel.acens.net](https://panel.acens.net/), abrir **Gestión DNS**, seleccionar
`findly.barcelona`, pulsar **Nueva entrada** y rellenar Entrada/Tipo/Valor.
Ver [guía de Acens](https://ayuda.acens.com/hc/es/articles/360015931858-Configurar-DNS-de-un-dominio).

| Registro          | Nombre                              | Valor                                                 |
| ----------------- | ----------------------------------- | ----------------------------------------------------- |
| 3 CNAME DKIM      | Cada nombre generado por SES/output | Cada destino generado por SES/output                  |
| MX MAIL FROM      | `bounce.findly.barcelona`           | prioridad 10, `feedback-smtp.eu-west-1.amazonses.com` |
| TXT SPF MAIL FROM | `bounce.findly.barcelona`           | `v=spf1 include:amazonses.com ~all`                   |
| TXT DMARC inicial | `_dmarc.findly.barcelona`           | `v=DMARC1; p=none; adkim=r; aspf=r`                   |

No inventar los identificadores DKIM. Comprobar si Acens añade automáticamente
el sufijo del dominio para no duplicarlo. No reemplazar el MX del dominio raíz
ni añadir un segundo SPF en un nombre que ya tenga uno. El MAIL FROM técnico
no crea un buzón para recibir respuestas en `info@findly.barcelona`.
DMARC empieza en observación; endurecer su política sólo tras verificar todos
los remitentes del dominio. Un buzón/reenvío de respuestas requiere configuración
propia y no forma parte del envío SES.

Verificar identidad, DKIM y MAIL FROM en SES; revisar cabeceras SPF/DKIM/DMARC
de mensajes de prueba. Documentar bandeja/spam por proveedor sin PII ni tokens.
Referencias: [identidades](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html),
[MAIL FROM](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html),
[DMARC](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dmarc.html).

## Activación por entorno y producción SES

Solicitar salida del sandbox SES en eu-west-1 para correo transaccional de
participantes con consentimiento; describir captura de consentimiento,
revocación, supresión y control manual. Confirmar aprobación y cuotas regionales
antes de permitir direcciones no verificadas. Mantener el ritmo global de
menos de un mensaje por segundo; revisar la cuota diaria frente al evento.
[Solicitud de acceso](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).

Configurar en el entorno elegido:

- `email_identity_arn`: ARN verificado en eu-west-1.
- `email_from_address`: `info@findly.barcelona`.
- `email_gallery_origin`: origen HTTPS propio que sirva `/gallery`, por
  `https://www.findly.barcelona` después de configurar DNS/certificado/web.

ADR-020 y #98 preparan el certificado y la identidad mediante el workflow
manual `configure-production-domain.yml` desde main, con environment
production limitado a main y rol OIDC `findly-shared-config`. Su input `apply`
es falso por defecto. La sesión administrativa aprobada configura el rol con
`FINDLY_AWS_ACCOUNT_ID` y `node scripts/configure-shared-config-role.mjs --apply`;
sin `--apply` sólo genera documentos. No publicar planes ni estados.
Añadir en Acens los outputs públicos DKIM/MAIL FROM y el CNAME de validación
ACM generado por `infra/web-certificate`; conservarlo para renovación.
No apuntar `www` a CloudFront hasta preparar y comprobar su distribución.
Una vez verificadas identidad, DKIM y MAIL FROM, ejecutar el mismo workflow
con `request_production_access=true` para solicitar acceso SES transaccional.
La solicitud describe los pendientes reales y no incluye buzones de prueba.
La aprobación AWS es externa; una solicitud pendiente no se vuelve a enviar.
Verificar `/gallery` en HTTPS antes de habilitar envíos. El ARN vacío
deshabilita los recursos y rutas de envío.
El formulario sigue exigiendo email aunque el envío esté deshabilitado.
No habilitar este módulo en CI efímera para enviar a terceros; usar simulador
SES o buzones de prueba expresamente autorizados en una prueba AWS futura.
Las ampliaciones de permisos de roles externos se revisan aparte del Terraform.

## Preparación de producción

Generar documentos revisables con la sesión administrativa aprobada:
`FINDLY_AWS_ACCOUNT_ID=... node scripts/configure-production-role.mjs --out-dir=...`.
La opción `--apply` configura exclusivamente el rol de despliegue y su límite
de ejecución; no despliega el stack. El límite de aplicación es obligatorio en
producción y el desplegador no puede retirarlo o modificarlo.

Configurar variables públicas en environment production: cuenta/bucket de
estado, `AWS_DEPLOY_ROLE_ARN`, buckets únicos production, dominio
`www.findly.barcelona`, certificado ACM emitido y las variables de correo SES.
Sólo main está permitida; originales y reejecutores deben ser responsables
autorizados. El workflow verifica SES/DKIM/MAIL FROM, cuota/acceso regional,
SPF/DMARC públicos y certificado antes de planificar producción.

Después de configurar correo, ejecutar Deployment para production con
`prepare_production_bindings=true` y `apply=true`. Revisar los IDs exactos de
API/OAC mediante el configurador de roles: exige propiedad de API/distribución,
origen S3 de producción y OAC vinculado. Configurar CNAME `www` al nombre real
CloudFront que devuelva ese entorno, conservando CNAME de validación ACM.
Ejecutar el despliegue completo con `prepare_production_bindings=false`.
El smoke verifica HTTPS y ruta SPA `/gallery`, sin probar todavía recepción
ni abrir una galería privada; éstos requieren las pruebas autorizadas de #98.

## Operación y recuperación

El administrador selecciona evento, pulsa Enviar galerías y confirma el envío.
Otro envío confirmado reenvía a todos los elegibles. La SPA bloquea doble clic,
sondea progreso y mantiene UUID ante un error de solicitud. Tras diez minutos
sin avance muestra recuperación de la misma operación. También puede repetirse
POST con el mismo UUID para reparar el hueco entre persistencia y encolado.

- SES aceptado no equivale a entregado. No reenviar automáticamente inciertos.
- Throttling confirmado se reintenta por SQS. Tras cinco intentos, inspeccionar
  alarma/DLQ, corregir causa y redrive con autorización operativa o reanudar la
  misma operación. No mostrar mensajes de cola ni errores SDK crudos en logs.
- Rebotes permanentes/quejas incrementan contadores una vez. La configuration
  set habilita supresión SES; el worker consulta la lista antes de enviar.
- Una operación puede terminar y recibir feedback después. Feedback sobre
  datos ya borrados se ignora. Las colas de feedback retienen una hora y su DLQ
  necesita intervención rápida; no copiar sus cuerpos a evidencias.
- DELETE/purga eliminan estados individuales y todas las capacidades adicionales.
  La lista regional SES es externa: revisar acceso y solicitudes de privacidad
  sin retirar supresión automáticamente y permitir nuevos envíos por accidente.

## Evidencia requerida para cerrar #86

Probar autorización JWT real, cuotas, reintento/DLQ, rebote/queja y supresión con
simulador; caducidad/borrado con trabajo en cola; recepción y apertura del enlace
en demo con buzones autorizados de proveedores distintos. Registrar cabeceras
de autenticación y bandeja/spam sin dirección, inscripción, token ni URL secreta.
No cerrar #86 por pruebas simuladas; mantener #49 abierta por instrucción del
responsable.

## Ejecución de la aceptación autorizada

Después del despliegue y HTTPS, generar un manifiesto fuera del repositorio con
`node scripts/prepare-email-acceptance.mjs --out=<ruta-privada>`; el fichero es
privado y caduca en seis horas. Revisar los documentos del operador mediante
`configure-email-acceptance-role.mjs --manifest=<ruta> --outputs=<outputs-privados>
--out-dir=<directorio-privado>` antes de aplicar exclusivamente IAM con la
sesión administrativa autorizada. Nunca publicar outputs ni manifiesto.

Configurar los secretos production `FINDLY_EMAIL_ACCEPTANCE_MANIFEST` y
`FINDLY_EMAIL_ACCEPTANCE_RECIPIENTS` mediante entrada privada. Ejecutar
`Verify production gallery email` primero en fase synthetic, confirmando que
no hay tráfico. Revisar AWS y limpieza antes de registrar el marcador
`FINDLY_EMAIL_ACCEPTANCE_SYNTHETIC:<runId>` en #98 y las variables públicas
`FINDLY_EMAIL_ACCEPTANCE_SYNTHETIC_RUN_ID` y
`FINDLY_EMAIL_ACCEPTANCE_SYNTHETIC_STARTED_AT` de esa ejecución.

En los marcadores, `runId` es el ID numérico de GitHub Actions, distinto del
UUID privado del manifiesto. Crear un manifiesto nuevo si no quedan al menos
65 minutos antes de su caducidad al iniciar el job.

La fase recipients envía sólo a los buzones autorizados. Dentro de su ventana
de treinta minutos, comprobar cada mensaje y abrir su galería. Registrar en
la issue #98 un marcador por proveedor A/B, sin direcciones ni enlaces:
`FINDLY_EMAIL_ACCEPTANCE_RECEIPT:<runId>:A` seguido de un JSON con `spf`,
`dkim`, `dmarc` iguales a `pass`, `folder` igual a `inbox` o `spam`, y
`opened: true`; repetir con B. Sólo los responsables autorizados y evidencia
posterior al inicio se aceptan. No registrar resultados inferidos de SendEmail.
Una espera agotada revoca los enlaces y deja recepción/apertura pendientes.
Comprobar siempre limpieza; si se cancela el job bruscamente, intervenir con
los identificadores privados antes de admitir tráfico real.

Si la revocación falla, conservar el manifiesto, las capacidades y referencias
de esa ejecución para reintentar la limpieza. No sustituir sus permisos por los
de un manifiesto nuevo ni admitir tráfico hasta resolver los datos pendientes.
La observación de colas vacías es puntual: feedback posterior aún puede llegar
y el handler debe ignorar registros ya borrados.
