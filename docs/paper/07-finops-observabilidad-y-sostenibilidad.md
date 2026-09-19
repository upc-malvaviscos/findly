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
conexión a AWS y con pruebas automatizadas. Todavía no se ha aplicado en una
cuenta, por lo que la entrega real de la alerta y el desvío a la DLQ quedan por
demostrar; se detallan en `docs/evidence/issue-13-observability-finops.md`.
