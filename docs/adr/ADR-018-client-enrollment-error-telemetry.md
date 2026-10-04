# ADR-018: Telemetría de errores de inscripción observados por el cliente

## Contexto y autorización

La [spec 18](../../specs/18-replace-web-mocks-with-real-backend.md) exige que
las métricas de error de registro, subida y polling estén disponibles para
validar el entorno `demo`, sin PII, tokens ni identificadores de asistentes
(issue #22). Hasta ahora sólo existían `RegistrationErrors` y `PollingErrors`,
derivadas de los logs de las Lambdas. La subida es un `PUT` directo del
navegador a S3 con URL prefirmada y no pasa por ninguna Lambda. Además, los
fallos de red, CORS o timeout que ve el navegador nunca llegan al servidor. Los
contadores del cliente (`getEnrollmentErrorCounts`) sólo viven en memoria.

La persona responsable aprobó el 2026-10-04 un endpoint de telemetría que
reporte las tres etapas, y verificarlo ampliando el smoke de demo.

## Decisión

- Nueva ruta pública `POST /telemetry/enrollment-errors`, servida por el
  handler `publicEnrollment.reportClientEnrollmentError`. Reutiliza el
  artefacto `publicEnrollment.zip`.
- El cuerpo sólo admite dos enums cerrados, definidos en
  `src/shared/lib/enrollmentErrorTelemetry.ts`:
  `{ stage: 'registration' | 'upload' | 'polling', code: <lista cerrada> }`.
  Los estados HTTP se agrupan por clase (`HTTP_4XX`, `UPLOAD_HTTP_5XX`…), y
  cualquier texto libre se convierte en `UNKNOWN`. Se rechazan con `400
INVALID_REQUEST`, sin registrar el reporte:
  - los campos adicionales (zod `.strict()`);
  - los valores desconocidos;
  - los cuerpos de más de 256 bytes.

  Una petición válida responde `204`.

- La Lambda escribe una línea `client_enrollment_error` con `stage`,
  `clientErrorCode` y `correlationId`. Son los campos cerrados del logger; no
  lee cabeceras.
- La Lambda tiene un rol propio con permisos únicamente sobre su grupo de logs
  (14 días). No tiene acceso a DynamoDB ni a S3.
- El metric filter `ClientEnrollmentErrors` (namespace `Findly/{environment}`)
  usa la dimensión `Stage`. Son tres series fijas, sin identificadores, y
  conviven con las métricas de servidor `RegistrationErrors` y `PollingErrors`.
- El cliente reporta desde `counted()` en `src/web/api.ts`, además del contador
  en memoria. El envío es _fire-and-forget_ (`fetch` con `keepalive`): nunca
  bloquea ni rompe la inscripción y se limita a 20 reportes por sesión. En modo
  `mock` no envía nada. Los componentes de presentación no cambian.
- Contra el abuso:
  - CORS limitado al origen del frontend, como el resto de la API.
  - Throttling propio de la ruta en el stage `$default`: ráfaga de 10 y 5
    peticiones/s.
  - La clave de ruta llega al módulo `api-gateway` como salida de
    `public-enrollment`. Así el stage se ordena después de la ruta sin crear
    ciclos.
- El smoke de demo (`scripts/test-demo.mjs`) provoca desde el origen publicado:
  - un registro inválido;
  - un polling con token ajeno;
  - un reporte sintético por etapa, más un reporte con un identificador
    añadido, que debe rechazarse.

  Después consulta `cloudwatch:GetMetricData` hasta encontrar al menos un dato
  en las cinco series. El rol `findly-demo-deploy` recibe sólo esa acción de
  lectura, limitada a `eu-west-1`.

## Consecuencias

- Las tres etapas tienen una métrica persistente en CloudWatch. La subida se
  observa desde el cliente, que es el único punto donde es visible.
- Al ser una ruta pública, un tercero podría inflar la métrica. Se acepta ese
  riesgo residual: no expone ni altera datos de asistentes, y el throttling y
  la retención de 14 días acotan su coste.
- El coste es por uso (API Gateway, Lambda y Logs). Tres series personalizadas
  quedan dentro de la capa gratuita de métricas de CloudWatch. No hay recursos
  con coste fijo.
- Los reportes son una señal operativa, no una auditoría. El tope por sesión y
  `keepalive` implican que no se garantiza la entrega de cada fallo.

## Alternativas descartadas

- **Métricas de petición de S3 (`4xxErrors`) con filtro de prefijo:** tienen
  coste mensual fijo por métrica y no ven los fallos de red, CORS ni timeout.
- **CloudWatch RUM:** necesita un identity pool de Cognito para invitados,
  recoge datos del navegador más allá de lo necesario y añade un servicio para
  tres contadores.
- **Mantener sólo los contadores de sesión:** no cumple el criterio de la spec
  18 en `demo`.

## Verificación desplegada

El run [37198156959](https://github.com/upc-malvaviscos/findly/actions/runs/37198156959)
verifica el contrato desde la SPA publicada con CORS nativo y confirma las
cinco series en `Findly/demo`. Lecturas AWS independientes comprueban el rol
limitado a logs, retención de 14 días, throttling, dimensión Stage y tres
reportes válidos sin los campos sensibles revisados. El detalle del ciclo
autorizado y sus límites consta en
[la evidencia de PR #93](../evidence/2026-10-04-pr-93-demo-acceptance.md).
