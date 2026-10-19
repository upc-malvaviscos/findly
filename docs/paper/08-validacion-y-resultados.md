# 8. Validación y resultados

Cada afirmación de esta sección enlaza a la evidencia reproducible que la
respalda. Una suite verde sólo acredita los recorridos que ejecuta:
`aws-sdk-client-mock`, HTTP interceptado o Floci nunca acreditan AWS real
(`docs/evidence/issue-checklist-audit.md`).

## Pruebas unitarias y de contrato

La siguiente instantánea histórica corresponde a la ejecución local sobre
`main` (commit `37d0c80`, 2026-09-30, Node 24.17.0). Las revisiones posteriores
se registran en la actualización operativa de correo al final del capítulo:

```text
npm run typecheck   PASS
npm run lint:code   PASS
npm run build       PASS (web + 9 artefactos Lambda .js/.zip)
npm run test        294 tests, 38 archivos; 290 pasan
```

De las 4 pruebas que fallan en este entorno, las cuatro pertenecen a
`tests/infra/deployedObservability.test.ts`: su fixture de CLI escribe un
ejecutable `aws` sin extensión con cabecera `#!`, un patrón POSIX que la
resolución nativa de procesos de Windows no reconoce como ejecutable en
`PATH` (exige `PATHEXT`: `.exe`, `.cmd`, `.bat`…). El proceso hijo localiza en
su lugar el `aws` real instalado en el sistema y falla por falta de región,
no por el fallo controlado que la prueba espera. Es una limitación del arnés
de pruebas específica de Windows, verificada de forma aislada reproduciendo el
mismo patrón de PATH fuera de Vitest; no es una regresión de `main` y no
afecta a la CI real, que se ejecuta en Ubuntu. No se ha corregido en esta
entrega: exige decidir una variante de fixture por plataforma o hacer
`scripts/deployed-observability.mjs` consciente de shell, un cambio a un
script que también corre contra AWS real y queda fuera del alcance de esta
memoria.

Cobertura de líneas de las 290 pruebas restantes (`src/lambdas`,
`src/lambdas/lib`, `src/shared/lib`, `src/web`, excluyendo el proyecto
`infra`):

| Ámbito              | Líneas  | Umbral del gate (`vitest.config.ts`)           |
| ------------------- | ------- | ---------------------------------------------- |
| `src/lambdas`       | 93,78 % | >= 90 %                                        |
| `src/lambdas/lib`   | 100 %   | >= 90 %                                        |
| `src/shared/lib`    | 100 %   | >= 90 %                                        |
| Global del proyecto | 81,34 % | Sin umbral global; no se presenta como >= 90 % |

## Pruebas E2E

Playwright cubre el recorrido mock/HTTP simulado (`npm run test:e2e`) y el
recorrido contra Floci con DynamoDB/S3 emulados (`npm run test:e2e:local`).
La [integración de #70](../evidence/issue-70-integration.md) registra la
última ejecución conjunta: 12 pruebas E2E en Chromium, Firefox y WebKit, y 21
pruebas contra Floci con teardown completo de contenedores, volúmenes y red.
Ninguna de las dos activa Rekognition, Cognito ni IAM reales.

Un tercer nivel, añadido por la PR #72 (issue #7), se ejecuta entre ambos en
el job `e2e` de CI: `npm run test:floci:integration` (14 pruebas) invoca
`selfieIndexer` con eventos S3 construidos en el propio test contra un
contenedor Floci aislado y de un solo uso (proyecto aleatorio, puerto libre).
Cubre persistencia, `GSI1`, duplicados, escrituras condicionales concurrentes,
recuperación de bloqueo y borrado durante el procesamiento — sin pasar por
Playwright ni por un navegador. Tampoco demuestra reconocimiento facial real,
notificaciones S3→Lambda nativas ni IAM; Rekognition sigue simulado.

## Infraestructura como código

La revisión inicial validó cinco roots de Terraform (`bootstrap`,
`environments/{sandbox,demo,production}`, `ephemeral`) con el proveedor AWS
6.66.0 y Node 24 en las funciones
Lambda (`docs/runbooks/issue-70-aws-review.md`, sección "Upgrade aprobado de
proveedor"). `terraform validate` conserva avisos de deprecación sobre
`hash_key`/`range_key` sin migrar el esquema de DynamoDB. `npm run security`
audita dependencias de producción sin vulnerabilidades.

El backend de estado remoto (ADR-009) se verificó en una cuenta AWS dedicada
en `eu-west-1` el 2026-10-02 (issue #61, sub-issue de #11;
[evidencia](../evidence/issue-11-terraform-remote-state.md)):

- **Bootstrap.** `infra/bootstrap` creó el bucket de estado (6 recursos). Su
  configuración, leída de AWS, confirma versionado, SSE-S3, los cuatro
  bloqueos de acceso público, caducidad de versiones no actuales a 90 días y
  la política TLS-only. Una petición firmada por HTTP recibe `AccessDenied`
  por denegación explícita y por HTTPS funciona.
- **Migración con `moved`.** Se creó un estado `sandbox` real desplegando la
  raíz anterior a ADR-009 (38 recursos con los módulos en la raíz). El `plan`
  de `environments/sandbox` actual contra ese estado mueve los 38 recursos
  bajo `module.findly` sin destruir ni recrear ninguno (`0 to destroy`), y el
  comprobador `check-deployment-plan.mjs` lo acepta. Ese `plan` no se aplicó y
  los recursos de la prueba se destruyeron al terminar.

En esa verificación no se ejecutaron planes reales de `demo` ni `production`;
los despliegues posteriores se documentan por separado.

## Aceptación desplegada en AWS real

La evidencia con mayor peso de esta memoria es el run de aceptación efímera de
[PR #71](https://github.com/upc-malvaviscos/findly/pull/71), ejecutado el
2026-09-28 contra un stack Terraform real por número de PR
(`infra/ephemeral`), con [registro completo del
run](https://github.com/upc-malvaviscos/findly/actions/runs/36482560393) y
`destroy` posterior verificado (103 recursos destruidos, estado remoto vacío).
Demuestra, contra servicios AWS reales y no simulados:

- **Inscripción pública**: navegador real → consentimiento → `PUT` S3
  condicional (`If-None-Match: *`) → indexación Rekognition →
  `FAILED`/`ENROLLED` reales por sondeo.
- **Matching**: similitud sintética >= 95 %; una foto repetida no sobrescribe
  `matchId` (idempotencia); galería privada servida con URLs prefirmadas.
- **Derecho al olvido**: `DELETE` con token ajeno o revocado rechazado;
  borrado del `FaceId` indexado en Rekognition; ausencia posterior de
  `REG`/`MATCH`/`TOKEN`/selfie; galería devuelve `404` tras el borrado.
- **Firmas y CORS**: firmas de método, clave o `Content-Type` manipuladas
  rechazadas; preflight CORS nativo (sin interceptación de red); SSE-S3 en el
  bucket de cargas.
- **Resiliencia de colas**: un mensaje venenoso original llegó a la DLQ tras
  tres recepciones fallidas (`maxReceiveCount = 3`); la alarma real se activó
  y la notificación SNS → SQS se recibió y procesó.
- **Observabilidad**: doce grupos de logs con retención de 14 días; líneas
  JSON con `correlationId`; comprobación automática de ausencia de campos
  sensibles en los mensajes capturados.

**Lo que este run no acredita**, textualmente, según su propio cierre: el
aviso real de AWS Budgets, un correo de alerta confirmado, el disparo del
`EventBridge Scheduler` real (la purga se invocó manualmente, no por cron), ni
una SPA de demostración publicada. El detalle de permisos IAM aprobados para
el rol de CI efímero, incluidas las tres ampliaciones puntuales necesarias
para completar este run, está en `docs/runbooks/issue-70-aws-review.md`.

### Cierres posteriores verificados en AWS real (2026-10-02 a 2026-10-15)

Varios de los huecos anteriores se cerraron con nueva evidencia desplegada,
sin repetir lo ya acreditado por PR #71:

- **`EventBridge Scheduler` real (issue #10, cerrada).** PR #84 ejecutó el
  cron real (no una invocación manual) contra el entorno efímero
  (run `36991833773`) y confirmó la purga programada. Una entrega posterior
  (PR #123) añadió el escenario que faltaba — reintento tras un fallo
  parcial de borrado — y encontró dos fallos reales al ejercerlo por primera
  vez: un error no capturado en `deleteRegistration.ts` que rompía la
  observabilidad (corregido con un `catch` que devuelve un 500 formado), y
  un patrón de filtro de CloudWatch Logs mal formado en el propio script de
  aceptación. Ambos corregidos y reverificados contra AWS real.
- **Backend de estado remoto (issue #11/#61, cerradas).** PR #62 (código) y
  PR #83 (verificación en AWS real, issue #61) confirmaron el bootstrap y la
  migración `moved` sin destruir recursos (sección anterior).
- **Demo persistente (issue #15, cerrada).** PR #92 publicó y probó una SPA
  `demo` funcional contra un backend de estado real (run `37151100042`,
  intento 3), y la borró deliberadamente por control de coste tras
  demostrarla (run `37157185461`, idempotente sobre datos ya vacíos,
  backend compartido conservado). **No queda una URL de `demo` activa** —
  se demostró y se desactivó por diseño, no por un fallo.
- **Backend web real (issue #22, cerrada).** PR #93/#94 verificaron en AWS
  real la SPA pública, Cognito, inscripción/`PUT`/CORS, matching, galería y
  cinco series de métricas de error de cliente, con destrucción posterior
  comprobada (114 y 111 recursos respectivamente).
- **Inscripción facial (issue #7, cerrada).** PR #72 y PR #81 acreditaron en
  AWS real los tres criterios de la spec 06, incluida la política IAM
  permanente `findly-ephemeral-pr-extensions` que sustituyó los permisos
  puntuales por número de PR.
- **Galería: refresco, descarga y enlace compartido (issue #88, cerrada).**
  PR #127 verificó en AWS real que las URLs de S3 ya emitidas (inline y
  descarga) siguen funcionando tras el borrado de la inscripción, y que los
  logs de `gallery-reader`/`delete-registration` no contienen el token ni el
  `registrationId`. PR #130 verificó, con un navegador real contra S3 real
  (no Node, no un doble interceptado), la descarga autorizada: Chromium y
  Firefox descargaron el archivo con el nombre y contenido correctos;
  WebKit agotó el tiempo de espera del evento de descarga contra S3 real,
  acotando — no sólo como hipótesis, sino como resultado medido en CI — la
  limitación ya conocida de Playwright con WebKit más allá de la
  interceptación de rutas.
- **Galería: coincidencias tras refresco (issue #107, cerrada).** Una
  inspección de producción encontró un fallo inicial de indexación
  recuperado por reentrega SQS, y una regresión real en el frontend: el
  refresco actualizaba los datos pero no abandonaba el estado `EMPTY`. PR
  #108 corrigió la transición de estado y añadió un diagnóstico CLI de
  sólo lectura (`scripts/diagnose-matching.mjs`).
- **Enlace de galería invisible tras inscripción (issue #125, cerrada).**
  Bug de producción (`www.findly.barcelona`): el mensaje de confirmación
  afirmaba que la galería podía abrirse pero el enlace se renderizaba fuera
  del panel de confirmación. PR #126 lo corrigió y lo verificó visualmente.
- **Dominio y correo de producción (issue #98, cerrada).** La SPA y la
  API de producción (`www.findly.barcelona`) están desplegadas y son
  públicas desde el 2026-10-05 (identidad SES, DKIM y MAIL FROM verificados;
  certificado ACM emitido). El 2026-10-15 AWS confirmó acceso de producción
  concedido y envío regional habilitado. Después de revisar el plan, el
  [despliegue OIDC 38781070488](https://github.com/upc-malvaviscos/findly/actions/runs/38781070488)
  habilitó el correo: 36 recursos creados, 13 modificados y cero destruidos,
  conservando Cognito con SES. La aceptación sintética (run 38950320818) superó
  los 9 escenarios de resiliencia y la prueba en buzón autorizado (run 38955016584)
  acreditó la entrega transaccional en `info@findly.barcelona` con SPF, DKIM y DMARC pass,
  apertura interactiva de la galería y limpieza completa, cerrando la issue.

## Aceptación desplegada issue #87: matching convergente tras subir selfies o fotos

Run de aceptación AWS real independiente, ejecutado el 2026-10-14 contra el
entorno sandbox (`infra/environments/sandbox`, no el root efímero de PR) con
`scripts/deployed-issue-87-acceptance.mjs` (nuevo), y destruido al terminar
(117 recursos, estado remoto vacío, 5 colecciones Rekognition borradas
explícitamente — no las gestiona Terraform). Detalle completo y logs citados
en
[`issue-87-matching-convergence.md`](../evidence/issue-87-matching-convergence.md).

Demuestra, contra Rekognition/DynamoDB/SQS reales, los tres órdenes de
subida de la issue #87:

- **Selfie antes de foto**: `ENROLLED` en 10,2 s; coincidencia al 100 % de
  similitud por el disparo S3 existente (spec 07), sin regresión.
- **Foto antes de selfie**: foto subida primero; `ENROLLED` 5,8 s después de
  la selfie; coincidencia al 100 % **sin volver a subir la fotografía** — la
  produjo el backfill de la issue #87 (capítulo 4).
- **Subidas simultáneas**: selfie y foto lanzadas en paralelo; 10 s después
  de la primera coincidencia, sigue existiendo **exactamente una** —
  convergencia sin intervención administrativa y sin duplicar, bajo una
  carrera real entre los dos disparadores, no solo en el diseño.

Un hallazgo real no anticipado en la spec: en los dos últimos escenarios, el
disparo S3 normal falló su primer intento (`ResourceNotFoundException` en
`IndexFaces`) porque la colección Rekognition del evento todavía no existía
—solo `selfieIndexer` la crea, de forma perezosa, en la primera selfie—;
quedó para reintento de SQS mientras el backfill, que corre después de
`ENROLLED`, sí la encontró creada y matcheó con éxito. Confirma en AWS real,
no solo en el diseño, que la condición idempotente `attribute_not_exists(PK)`
de `writeMatch` es la única garantía de convergencia que hace falta.

**Lo que este run no acredita**: "sin rostro / bajo umbral / otro evento",
paginación con varias páginas reales y borrado _durante_ el matching (no
solo después) siguen demostrados únicamente por las 626 pruebas unitarias
del proyecto, no por este run. El benchmark de coste/capacidad que ADR-022
exige para cerrar la issue #49 tampoco queda satisfecho — este run aporta una
carrera real documentada, no esas medidas. La issue #87 permanece abierta
hasta sincronizar este resultado en GitHub.

## Seguridad y gobierno de datos

`docs/evidence/issue-70-verification-gates.md` registra la corrección del
presigner S3 (firma explícita de `content-type` con el SDK real, sin mock de
`getSignedUrl`) y el gate de cobertura por ámbito. Los ADR-013/014/015
(capítulos 4 y 6) están verificados dentro del mismo run de aceptación:
localizador de limpieza sin TTL, PUT condicional de una sola escritura para
selfies y aislamiento de colecciones Rekognition por entorno.

## Estado de FinOps y observabilidad (issue #13, cerrada)

El módulo `monitoring` (topic SNS, presupuesto al 80 % de gasto real,
alarma de la DLQ) está verificado con un `terraform plan` sin conexión a AWS
y con pruebas automatizadas (`docs/evidence/issue-13-observability-finops.md`).
La alarma DLQ y la entrega SNS → SQS están verificadas en AWS real (sección
anterior, PR #71); el aviso real de AWS Budgets nunca se aplicó ni se
disparó en ninguna cuenta. La issue se cerró el 2026-10-14 (PR #122) por una
decisión explícita de la persona responsable: aceptar la entrega SNS → SQS
ya acreditada como evidencia suficiente del canal de aviso, en vez de forzar
gasto real o esperar indefinidamente en una cuenta efímera no persistente
para que Budgets dispare su propio umbral. Si se necesitara esa evidencia en
el futuro, requeriría una cuenta persistente y una nueva issue — no se
presenta como demostrada.

## Matriz de trazabilidad spec ↔ issue ↔ evidencia

Cada fila enlaza una spec con la issue que la implementó y el fichero de
evidencia reproducible que lo demuestra — la regla de `AGENTS.md` de que
ninguna de las tres piezas se cierra sin sincronizar las otras dos, aplicada
como tabla. Se omiten las specs sin evidencia dedicada propia (00, 01, 13, 16, 19) porque su verificación vive en la CI general (capítulo 5), no en un
fichero de `docs/evidence/` individual.

| Spec | Issue | Evidencia                                                                                             | Estado                                                            |
| ---- | ----- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 02   | #3    | `issue-03-domain-contracts.md`                                                                        | Cerrada                                                           |
| 02   | #49   | `issue-49-dynamodb-vs-rds-analysis.md`                                                                | Abierta (análisis, sin decisión)                                  |
| 03   | #4    | `issue-04-frontend-auth.md`                                                                           | Cerrada (backend real en #22)                                     |
| 04   | #5    | `issue-05-admin-cognito.md`, `issue-05-09-platform-foundation.md`                                     | Cerrada                                                           |
| 04   | #105  | `admin-invitations-aws-plan.md`                                                                       | Abierta (recepción/primer acceso real sin confirmar)              |
| 05   | #6    | `issue-06-presigned-uploads.md`; verificación de firma/CORS (#45) en `issue-70-verification-gates.md` | Cerrada 28-sep tras PR #71                                        |
| 06   | #7    | `issue-18-paper-runbook.md` (cita el cierre de #7)                                                    | Cerrada 02-oct tras PR #72/#81                                    |
| 07   | #8    | `issue-08-photo-matching.md`; verificación de DLQ (#46) en `issue-70-verification-gates.md`           | Cerrada 28-sep tras PR #71                                        |
| 08   | #9    | `issue-09-private-gallery.md`                                                                         | Cerrada                                                           |
| 08   | #107  | `issue-107-gallery-refresh.md`                                                                        | Cerrada tras PR #108                                              |
| 09   | #10   | `issue-10-consent-erasure.md`, `issue-70-erasure-retention.md`                                        | Cerrada tras PR #84 (cron real) y PR #123 (retry real)            |
| 10   | #11   | `issue-11-terraform-remote-state.md`                                                                  | Cerrada (PR #62/#83; sub-issue #61 incluida)                      |
| 11   | #12   | `issue-12-secure-serverless-infra.md`                                                                 | Cerrada                                                           |
| 12   | #13   | `issue-13-observability-finops.md`                                                                    | Cerrada tras PR #122 (Budgets real fuera de alcance)              |
| 14   | #15   | `issue-15-permanent-demo.md`                                                                          | Cerrada; demo probada y desactivada por coste (PR #92)            |
| 15   | #16   | `issue-16-ephemeral-pr-ci.md`                                                                         | Cerrada                                                           |
| 17   | #18   | `issue-18-paper-runbook.md`                                                                           | Abierta (esta memoria; bloqueada por #49/#86/#87/#89)             |
| 18   | #22   | `issue-22-web-real-backend.md`, `issue-70-public-enrollment.md`                                       | Cerrada tras PR #93/#94                                           |
| 20   | #86   | `issue-86-gallery-email.md`                                                                           | Abierta (entregabilidad externa en #98)                           |
| 20   | #98   | `issue-98-ses-production.md`                                                                          | Abierta (correo desplegado; aceptación/entregabilidad pendientes) |
| 22   | #88   | `issue-88-gallery-refresh-download-sharing.md`                                                        | Cerrada tras PR #127/#130/#131                                    |
| —    | #70   | `issue-70-*.md` (5 ficheros), `issue-checklist-audit.md`                                              | Abierta (coordina fase 3)                                         |
| 21   | #87   | `issue-87-matching-convergence.md`                                                                    | Abierta (AWS real de los 3 órdenes; #49 propio pendiente)         |

La [matriz de auditoría de #70](../evidence/issue-checklist-audit.md)
distingue, issue por issue, qué criterios están respaldados por evidencia
desplegada y cuáles siguen dependiendo de una suite mock o Floci. De las
filas anteriores, `#18`, `#49`, `#70`, `#86` y `#98` permanecen abiertas: las
tres primeras por decisión/coordinación explícita, y `#86`/`#98` porque la
entrega real de correo (fuera del sandbox SES, DNS/DKIM/SPF/DMARC y
recepción en buzones autorizados) aún requiere aceptación completa. AWS ya
concedió acceso de producción SES y se autorizó un buzón para una prueba
parcial; sigue pendiente el segundo proveedor. El capítulo 9 detalla cada
limitación vigente.

## Actualización operativa de correo — 2026-10-15

La PR #133 superó los cinco checks obligatorios, incluida aceptación AWS
efímera y limpieza, antes de integrarse. Su suite mantiene el módulo de correo
desactivado. La revisión local completa pasó 623 pruebas; los contratos
Terraform de Cognito/stack se ejecutan sin credenciales y ahora también en CI.

El [plan revisado 38780832909](https://github.com/upc-malvaviscos/findly/actions/runs/38780832909)
conserva Cognito y prevé 36 altas, 14 modificaciones y cero borrados. El
[despliegue 38781070488](https://github.com/upc-malvaviscos/findly/actions/runs/38781070488)
terminó SUCCESS: 36 altas, 13 modificaciones y cero borrados, con correo
habilitado y publicación HTTPS verificada. Lecturas posteriores confirman
cuatro Lambdas, rutas JWT, feedback SES/SNS, consumidores y alarmas. La
simulación IAM restringe el remitente al worker. Estas comprobaciones no
equivalen a recepción real ni demuestran un crash original de SES o borrado
con una petición ya en vuelo. Véase [la evidencia de #98](../evidence/issue-98-ses-production.md).

Las revisiones posteriores incorporan también las raíces `email-identity` y
`web-certificate`: siete en total. La PR #137 supera localmente los gates con
653 pruebas y cero vulnerabilidades de producción; sus checks remotos y el
resultado de la repetición desplegada se registran por separado. La evidencia
de #98 conserva los intentos fallidos y su limpieza, sin atribuirles recepción
ni aceptación por SES.

La PR #140 corrigió la causa raíz del fallo en supresión (subaddressing no
admitido en `PutSuppressedDestination`) y clasificó `BadRequestException` en el
arnés. La repetición sintética en AWS ([run 38950320818](https://github.com/upc-malvaviscos/findly/actions/runs/38950320818))
completó los nueve escenarios previstos con limpieza verificada al 100%. A
continuación, la aceptación de destinatario único en AWS ([run 38955016584](https://github.com/upc-malvaviscos/findly/actions/runs/38955016584))
acreditó la entrega en la bandeja de entrada de `info@findly.barcelona` sin
clasificación de spam, autenticación criptográfica estricta (SPF pass en
`bounce.findly.barcelona`, DKIM pass con firmas de 2048 y 1024 bits, y DMARC
pass alineado), y la apertura y visualización interactiva de la galería privada
por el participante. La sincronización formal en la PR #142 cerró la issue #86;
la issue #98 completa y cierra su verificación con la evidencia sintética y de
entrega transaccional en producción, y la issue #49 quedó cerrada mediante el
benchmark de la PR #141.
