# 20 - Email obligatorio y envío manual de galerías con Amazon SES

<!-- requirement: REQ-MANUAL-GALLERY-EMAIL -->

<!-- requirement: REQ-PRODUCTION-DOMAIN -->

La configuración externa continúa en [#98](https://github.com/upc-malvaviscos/findly/issues/98)
y ADR-020: `www.findly.barcelona`
para web/galerías, DNS en Acens, identidad SES compartida y certificado ACM
separado. El bootstrap manual por OIDC sólo prepara estos recursos. No acredita
salida del sandbox, permisos del stack, recepción ni apertura; estos criterios
permanecen pendientes. Producción se despliega tras configurar el correo.
Evidencia: [configuración SES y producción](../docs/evidence/issue-98-ses-production.md).

## Objetivo

Exigir email en la inscripción y permitir que el administrador envíe por evento
un correo transaccional con el enlace de galería a todos los participantes con
matches. Cada pulsación intencionada reenvía a todos los destinatarios elegibles.
El matching no envía correos automáticamente.

## Estado y decisiones

Backlog aprobado el 2026-10-03; implementación descrita al final de esta spec. SES debe permitir
cualquier dirección válida, no solo destinatarios verificados. Dominio y remitente elegidos: `findly.barcelona` e `info@findly.barcelona`;
verificación SES/DNS pendiente. La selección individual
de usuarios queda fuera de este MVP.

Esta ampliación autoriza envío manual de galerías del evento a sus participantes
con matches; sustituye para ese caso la exclusión original de correos masivos.
No autoriza campañas de marketing ni SMS.

## Alineación con AWS Well-Architected Framework

- **Seguridad**: IAM mínimo, identidad SES verificada y ausencia de PII/tokens en logs.
- **Fiabilidad**: envío asíncrono, progreso y reintentos con fallos parciales.
- **Optimización de Costes**: bajo demanda, cuotas/concurrencia acotadas, sin IP dedicada.

## Dependencias y límites

Specs 02/03/06/08/09/18/21/22; #15 para configuración demo. #13 conserva alertas
SNS/Budgets y no implementa correos de participantes. #10 conserva borrado y retención.

## Requisitos funcionales y contratos

1. Email obligatorio, validado en UI, DTOs y API antes de generar la carga.
2. Inscripciones anteriores sin email: omitir del envío y mostrar recuento; no
   inventar destinatarios ni invalidar su galería por este cambio.
3. Botón del evento seleccionado protegido por Cognito y autorización backend.
4. Elegibles: inscripción vigente, consentimiento activo, email válido y al
   menos un match de una fotografía disponible de ese evento.
5. Cada nueva pulsación confirmada crea un envío para todos los elegibles,
   aunque ya recibieran otro. Doble clic o reintento de la misma petición no
   duplica el trabajo; acordar contrato de idempotencia.
6. Revalidar elegibilidad antes de enviar, también si borrado/caducidad ocurre
   con destinatarios en cola. Respetar supresión por rebotes permanentes/quejas.
7. Correo individual, sin CC ni imágenes adjuntas, con nombre del evento,
   enlace HTTPS propio y caducidad. Texto y HTML; sin acortadores ni tracking añadido.
8. Mostrar progreso, aceptados por SES, omitidos y fallidos. Aceptación del
   proveedor no equivale a entrega al buzón. Corregir la promesa de envío automático.

## Arquitectura y decisiones antes de implementar

Amazon SES en eu-west-1 desde backend; nunca credenciales o SDK SES en la SPA.
Trabajo asíncrono paginado, cuotas acotadas y recuperación de fallos parciales.
Acordar endpoints de solicitud/estado y modelo de idempotencia antes de codificar.

Solo se conserva el hash SHA-256 del token actual: no puede reconstruirse para
el email. Acordar emisión segura compatible con enlaces ya compartidos hasta
caducidad/borrado, sin guardar tokens en claro ni ampliar su retención. Registrar
ADR de cambios de datos/contratos. Documentar respuesta incierta de SES; no
prometer entrega exactamente una vez sin demostrarla.

## Entregabilidad y configuración externa

- Elegir/verificar dominio y remitente SES regional; configurar DKIM, SPF y
  alineación DMARC, y documentar MAIL FROM/DNS sin asumir proveedor DNS.
- Obtener acceso fuera del sandbox SES para destinatarios no verificados.
- Gestionar rebotes, quejas y supresión; probar entrega en proveedores distintos.
- Registrar ubicación bandeja/spam y cabeceras de autenticación de pruebas sin
  publicar PII ni enlaces secretos; no garantizar ausencia absoluta de spam.

Referencias: [autenticación SES](https://docs.aws.amazon.com/ses/latest/dg/email-authentication-methods.html),
[DMARC](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dmarc.html)
y [salida del sandbox](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).

## Guía de implementación

1. Acordar ADR/contratos de enlace, envío e idempotencia y configuración SES/DNS.
2. Hacer obligatorio el email y mantener compatibilidad explícita con datos anteriores.
3. Añadir envío individual asíncrono y botón/estado administrativo.
4. Probar autorización, reintentos, borrado concurrente y recepción real.

## Errores comunes a evitar

- Confundir alertas de #13 con correos de galería.
- Reconstruir un token desde su hash o invalidar enlaces compartidos al reenviar.
- Confundir aceptación SES con recepción o afirmar que nunca llega a spam.

## Criterios de aceptación y verificación

- [x] Email requerido en UI/API; ausencia, vacío y formato inválido rechazados.
- [ ] Botón por evento autenticado; ningún correo provocado por matching.
- [ ] Dos pulsaciones distintas reenvían; doble clic/reintento no duplica trabajo.
- [ ] Elegibilidad, legacy sin email, caducidad/borrado y supresión probados.
- [ ] Enlace correcto, compartible y compatible con borrado/caducidad.
- [ ] SES/DNS autenticados y acceso fuera del sandbox verificados.
- [ ] Progreso, fallos parciales y rebotes/quejas probados sin logs sensibles.
- [ ] Correo recibido y enlace abierto contra demo; evidencia de entregabilidad.
- [ ] Unitarias/contratos/E2E y gates; AWS efímero usa simulador SES o buzones
      de prueba autorizados, nunca envíos a terceros.
- [ ] ADR, evidencia e issue sincronizados antes del cierre.

## Fuera de alcance

Selección individual, campañas, SMS y envío automático al detectar matches.

## Issue de implementación

[86](https://github.com/upc-malvaviscos/findly/issues/86). Implementación preparada;
los criterios que requieren AWS y recepción real siguen pendientes.

## Implementación y verificación — 2026-10-04

Diseño aprobado para #86 en ADR-019; #49 permanece abierta por instrucción del
responsable. Dominio `findly.barcelona`, remitente `info@findly.barcelona`, DNS
Acens. Preparados formulario/API con email obligatorio, rutas JWT, confirmación
administrativa, operaciones/checkpoints SQS FIFO, SES individual, supresión y
feedback, capacidades adicionales y limpieza DELETE/purga.

Las pruebas unitarias y de navegador simulan SDK/HTTP: no verifican AWS real.
Terraform está deshabilitado por defecto mediante `email_identity_arn` vacío.
SES/DNS, acceso fuera del sandbox, IAM desplegado y entregabilidad permanecen
pendientes. La identidad compartida y los registros DNS se preparan en
`infra/email-identity`; no se han aplicado ni publicado.

Contratos, retención, carrera con SES y resultado incierto:
[ADR-019](../docs/adr/ADR-019-manual-gallery-email-capabilities.md).
Configuración y recuperación:
[runbook](../docs/runbooks/gallery-email-ses-acens.md).
Pruebas/pendientes:
[evidencia #86](../docs/evidence/issue-86-gallery-email.md).

Issue: [#86](https://github.com/upc-malvaviscos/findly/issues/86).
