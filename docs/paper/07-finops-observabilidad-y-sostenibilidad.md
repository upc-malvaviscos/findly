# 7. FinOps, observabilidad y sostenibilidad

Los entornos de pull request se etiquetan `Ephemeral=true` y con su número de
PR, usan DynamoDB bajo demanda y servicios serverless, y se destruyen al final
del workflow que los creó. Esto evita el coste residual de una limpieza cada
doce horas y no introduce RDS, NAT, EC2 ni VPC. El bucket de estado es una
excepción intencionada: es persistente, privado, versionado y queda fuera del
rol de destrucción. La cuenta debe vigilar recursos `Environment=pr-*` que
sobrevivan a una interrupción externa.

## Observabilidad

Las Lambdas escriben en CloudWatch Logs una línea JSON por evento, con un
`correlationId` que es el identificador de la petición de API Gateway, de la
invocación de Lambda o del mensaje de SQS. El registro admite una lista cerrada
de metadatos (`eventId`, `photoId`, `statusCode`, `durationMs`, el nombre de la
clase de error y contadores): no existe un campo para nombres, correos, tokens de
galería, `faceId`, `registrationId` ni mensajes de error, de modo que no pueden
llegar a los logs por descuido. Las respuestas de error devuelven ese mismo
identificador como `requestId`, lo que permite localizar en los logs el fallo que
reporta un usuario. Cada Lambda declara su grupo de logs con retención de 14
días, para que el almacenamiento no crezca sin límite.

Los errores de la inscripción pública se miden en sus tres etapas (ADR-018).
`RegistrationErrors` y `PollingErrors` cuentan las respuestas de error de las
Lambdas a partir de sus logs. La subida de la selfie, en cambio, va del navegador
directamente a S3, y los fallos de red o CORS nunca llegan al servidor. Para
estos casos, el cliente envía a `POST /telemetry/enrollment-errors` sólo la etapa
y un código de una lista cerrada. La métrica `ClientEnrollmentErrors` los cuenta
con la dimensión `Stage`. La ruta tiene throttling propio, y el cliente envía como
mucho 20 reportes por sesión.

El despliegue de demo del 2026-10-04 (run 37198156959) verificó las cinco
series desde la SPA publicada con datos sintéticos, además de inscripción,
subida, matching y galería. El ciclo manual, las lecturas de IAM/logs y sus
límites se registran en
`docs/evidence/2026-10-04-pr-93-demo-acceptance.md`. Esta comprobación no
acredita una alerta real de Budgets ni la recepción de correo.

La cola de fotos tiene una DLQ con una alarma que se activa con un mensaje o más.
La alarma y el presupuesto publican en un único topic SNS, que reenvía a un correo
configurado en el despliegue (nunca versionado) una vez que su destinatario
confirma la suscripción. Antes de esta medida, `PhotoMatcher` descartaba los
errores sin registrarlos; ahora cada mensaje fallido deja una línea con el nombre
del error.

## FinOps

AWS Budgets vigila el gasto mensual real y avisa al 80 % de un límite de 5 USD,
la cifra de demostración de la especificación de alcance. El presupuesto es de
ámbito de cuenta, no de entorno, y excluye créditos y reembolsos para que una
cuenta con créditos de capa gratuita no mida un coste neto de cero. Este control
avisa, no frena: no corta recursos al superar el límite.

Estado de validación: la configuración se verificó con un `terraform plan` sin
conexión a AWS y con pruebas automatizadas. La entrega real de la alerta de
Budgets y de un correo confirmado sigue pendiente (capítulo 9); el desvío a la
DLQ y la alarma sí están verificados en AWS real (capítulo 8). Detalle en
`docs/evidence/issue-13-observability-finops.md`.

### Principios FinOps aplicados, por spec de origen

Cada principio de coste de Findly viene de una spec explícita del Well-Architected
Framework, no de una convención genérica; el capítulo 4 detalla dónde vive cada
uno en el código:

| Principio                                            | Spec de origen | Mecanismo                                                                          |
| ---------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| Cero coste fijo por hora                             | 00, 11         | Sin RDS, EC2, NAT ni VPC dedicada (ADR-002); sólo servicios facturados por uso.    |
| Facturación por petición, no por capacidad reservada | 02             | DynamoDB `PAY_PER_REQUEST`; Lambda por invocación y duración.                      |
| Purga automática de datos que ya no aportan valor    | 02, 09         | TTL de DynamoDB + `retentionPurger` programado, no acumulación indefinida.         |
| Retención de logs acotada                            | 12             | 14 días en cada grupo de CloudWatch Logs; sin retención infinita por omisión.      |
| Aislamiento de coste por entorno efímero             | 15 (ADR-008)   | Cada PR crea y destruye su propio stack; nada queda facturando entre ejecuciones.  |
| Alerta antes de exceder el presupuesto, no después   | 12             | AWS Budgets al 80 % del gasto real (pendiente de confirmación en AWS, ver arriba). |

### Sostenibilidad

Findly no mide su huella de carbono — no hay una métrica ni una herramienta
de este proyecto que lo haga, y este capítulo no afirma un ahorro
cuantificado. La arquitectura serverless tiene, cualitativamente, una
propiedad alineada con el pilar de sostenibilidad del Well-Architected
Framework: al facturar y ejecutar por petición, no reserva capacidad de
cómputo inactiva a la espera de tráfico — a diferencia de una instancia EC2 o
RDS encendida 24/7 e infrautilizada la mayor parte del tiempo. La destrucción
garantizada de cada entorno efímero de PR (capítulo 5) tiene el mismo efecto
en la fase de desarrollo: no hay infraestructura de prueba corriendo sin uso
entre una ejecución de CI y la siguiente.
