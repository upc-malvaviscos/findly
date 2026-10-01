# #70: aceptación y límites de entorno

## Resultado de la ejecución (2026-09-28)

La [PR #71](https://github.com/upc-malvaviscos/findly/pull/71) se fusionó
después del
[run AWS 36482560393](https://github.com/upc-malvaviscos/findly/actions/runs/36482560393).
Los probes efímeros acreditaron el recorrido integrado, la purga invocada
manualmente, el redrive y SNS → SQS. El destroy eliminó 103 recursos y el
estado remoto PR71 quedó vacío. Las instrucciones siguientes describen el
procedimiento de la PR y sus límites; siguen pendientes la ejecución real del
Scheduler, Budgets/correo y una SPA demo publicada.

## Local

```sh
npm ci
npm run harness:check:e2e
npm run verify
npm run test:e2e
WEB_PORT=4175 LOCAL_API_PORT=8790 FLOCI_PORT=4568 npm run test:e2e:local
```

Ejecutar las suites secuencialmente en el mismo worktree: comparten dist y
reportes. Para agentes en paralelo usar worktrees y puertos independientes.
Floci incluye registro/consentimiento/token/polling UPLOAD_PENDING y DELETE
hacia handlers reales sobre servicios emulados; no activa Rekognition gestionado.

## AWS efímero

Revisar primero [permisos y configuración](issue-70-aws-review.md). Durante la
preparación, la PR draft no ejecutaba apply. Tras autorización del stack y
permisos mínimos, el workflow
provision-test-destroy usa estado exclusivo, construye Lambdas antes de plan y
ejecuta el smoke previo de admin/galería más deployed-issue-70-acceptance.mjs.

El script comprueba en un navegador real GET eventos, consentimiento, emisión
de token, PUT S3 y polling FAILED/ENROLLED. Usa el fixture generado de
[e2e/fixtures](../../e2e/fixtures/README.md), comprueba GSI facial, matching S3,
galería, borrado FaceId, firma/CORS, purga manual y redrive/alarma/SNS.
Sólo el documento vacío del origen se suministra localmente: las llamadas API
y S3 no se interceptan. Esto no equivale a navegar una SPA demo publicada.

Para selfies, verifica la cabecera firmada `If-None-Match: *`: omitirla
debe devolver 403, la primera escritura 200 y repetirla 412. Las fotos del
organizador mantienen su PUT anterior. El stack debe proporcionar el namespace
de colección al runner; las comprobaciones y cleanup usan únicamente ese
namespace del PR, con nombres de evento sintético únicos por ejecución.

Se registran cleanup de inscripción y colección antes de abandonar el runner.
Terraform destroy se intenta con always tras éxito o fallo. Las colecciones
Rekognition creadas por handlers no están en el estado Terraform y el smoke
las elimina explícitamente. Un fallo de limpieza impide declarar aceptación.
Comprobar además estado remoto vacío y ausencia de recursos etiquetados del PR.

El paso AWS ejecuta después `deployed-scheduler-retention.mjs`. Este probe
acelera solo durante la prueba el schedule del PR a un minuto, siembra eventos
sintéticos vencido y vigente, espera una invocación programada que limpie
DynamoDB/S3/Rekognition y restaura el cron diario. Requiere permisos del rol CI
limitados a ese PR para consultar/actualizar su schedule, pasar su rol de
Scheduler, leer TTL y crear/consultar/borrar sus colecciones sintéticas. La
invocación manual anterior sigue documentada por separado. El probe comprueba
la configuración de DynamoDB TTL, sin afirmar que el servicio haya borrado
un ítem dentro de la ventana del CI.

## Demo y #61

Antes de apply persistente, renovar sesión temporal AWS, revisar plan contra
estado previo sin destrucciones, aprobar dominio/certificado y rol por entorno.
El workflow Deployment permite plan sin apply. Demo/production conservan
allow_bucket_destroy=false y el bucket web no se vacía al destruir Terraform.
No ejecutar aws-sandbox destroy contra esos roots.

La aceptación final de #18 exige SPA publicada, recorrido completo de usuario,
medidas reproducibles y limpieza demo con objetivos acordados. Quedan separadas
la invocación manual de purga y la ejecución del cron, SNS→SQS de correo
confirmado, y el canal SNS del disparo real de Budgets. No forzar gasto.
