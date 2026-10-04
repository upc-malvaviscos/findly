# Evidencia de implementación de la issue #86

<!-- requirement: REQ-MANUAL-GALLERY-EMAIL -->

Fecha: 2026-10-04. Entornos: unitario/SDK simulado, navegador/HTTP simulado,
Floci y validación estática Terraform. Esta evidencia local no incluye despliegue
AWS, configuración DNS ni envío real. Diseño aprobado en ADR-019; dominio
`findly.barcelona`, remitente `info@findly.barcelona`, DNS Acens. #49 abierta.

## Alcance implementado

Email requerido en UI/DTO/API. Confirmación manual por evento, autenticación
JWT, operaciones UUID idempotentes y checkpoints paginados en DynamoDB/SQS FIFO.
SES individual con texto/HTML, supresión regional y feedback de rebotes/quejas,
contadores de aceptación, omisiones, legacy sin email, fallos e incertidumbre.
Nuevos tokens aleatorios con hash e índice inverso, sin invalidar enlaces
anteriores ni ampliar la retención. DELETE/purga limpian todos los enlaces
adicionales y estado individual. Feedback tardío no recrea datos borrados.

La identidad SES compartida queda en un root independiente; el módulo por
entorno está desactivado por defecto. No se modifica el disparador de matching
ni se habilita email en AWS efímero de PR.

## Matriz de criterios y evidencia

| Criterio de #86                              | Evidencia local                                                                                   | Pendiente AWS/externo                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Email requerido y validado                   | `validations.test.ts`, `publicEnrollment.test.ts`, `enrollment.test.tsx`, E2E de formulario       | Regresión de inscripción desplegada             |
| Botón por evento autenticado y manual        | `galleryEmail.test.ts`, `galleryEmailSender.test.tsx`, E2E administrativo; rutas JWT en Terraform | 401/JWT real; permisos de despliegue            |
| Reenvío deliberado / mismo UUID sin duplicar | Tests de operación, fallo de encolado/checkpoint, doble clic y reintento; E2E                     | Recuperación SQS/DLQ desplegada                 |
| Elegibilidad y legacy                        | Tests de consentimiento, TTL, evento, matches/foto/S3 y supresión                                 | Supresión/carreras con servicios reales         |
| Enlace correcto y revocable                  | Email HTTPS/texto/HTML, hash sin token, inverso sin TTL y limpieza paginada                       | Apertura en demo con dominio/certificado        |
| SES/DNS / fuera del sandbox                  | Root de identidad y runbook Acens                                                                 | Verificar DKIM/SPF/DMARC y acceso de producción |
| Progreso / fallos / feedback                 | Contadores, incertidumbre, throttling y feedback condicional                                      | Rebote/queja simulador y alarmas reales         |
| Recepción real                               | Ninguna; no se confunde aceptación SDK con entrega                                                | Buzones autorizados de distintos proveedores    |
| Unitarias / E2E / gates                      | Resultados reproducibles abajo                                                                    | AWS efímero de email con simulador autorizado   |
| ADR, evidencia, issue                        | ADR-019, spec 20, spec 02, README/memoria/runbook/traceability                                    | Sincronización GitHub y pendientes de cierre    |

## Validación reproducible

- `npm run harness:check` y `npm run harness:check:e2e`: entorno preparado,
  Node 24, dependencias bloqueadas y validadores locales.
- `npm run test`: 456 pruebas pasan; cobertura de `galleryEmail.ts` superior
  al 98 % de líneas. SDK simulado; no acredita SES ni IAM.
- `npm run test:e2e`: 21 pruebas pasan en Chromium/Firefox/WebKit; HTTP
  simulado, incluyendo email requerido, confirmación, reintento y reenvío.
- `npm run typecheck` y `npm run lint:code`: pasan.
- `npm run test:e2e:local`: 21 pruebas pasan; inscripción, matching,
  galería y borrado contra Floci. Floci no verifica SES.
- `npm run test:floci:integration`: 14 pruebas pasan contra DynamoDB/S3 Floci;
  Rekognition simulado. Corregidos los datos de inscripción de esta suite para
  aportar el email requerido después del fallo inicial del check remoto.
- `npm run terraform:validate`: los seis roots pasan; no se ejecuta `apply`.
- Pruebas Terraform con proveedor simulado: ocho casos de hosting y cuatro
  contratos de email pasan, incluyendo JWT, FIFO y rechazo de configuración
  incompleta/insegura.
- `npm run verify`: pasa completo (lint, tipos, 456 pruebas, build y paquetes
  Lambda, Terraform, seguridad y trazabilidad). Se reutiliza el paquete local
  completo de AWS 6.66.0 con comprobación contra el lockfile.
- `npm audit --omit=dev`: cero vulnerabilidades de producción.

La PR #97 está lista para revisión por autorización del responsable. Sus checks
incluyen AWS efímero con email desactivado; consultar el resultado remoto en la
PR. Ese flujo no sustituye las pruebas SES/recepción pendientes.

## Límites y cierre

No cerrar #86 con esta evidencia. Falta habilitar identidad y origen HTTPS,
publicar DNS en Acens, verificar salida del sandbox y revisar permisos del rol
externo; después pruebas AWS, simulador y recepción real sin publicar PII.
La issue #49 sigue abierta por instrucción del responsable. La selección de DynamoDB
para #86 no cierra ni reemplaza su análisis global.

SES no es transaccional con DynamoDB: un borrado después de la última validación
no cancela correo en vuelo. SDK SES usa un único intento; SENDING abandonado o
respuesta incierta se registra sin reenvío automático. Tras cinco fallos de
worker hay DLQ, alarma y recuperación manual de la misma operación. Las páginas
no constituyen un snapshot de inscripciones concurrentes. La lista de supresión
SES es externa y requiere revisión operativa de privacidad. Ver ADR-019.
