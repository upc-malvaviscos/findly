# ADR-015: colecciones Rekognition aisladas por entorno

## Estado

Aprobado por la persona responsable dentro del plan #70.

## Contexto

La creación de eventos calcula el identificador a partir de nombre y fecha.
Los mismos datos en dos entornos producen el mismo eventId. Una colección
global `findly-event-{eventId}` permitía compartir caras entre sandbox, demo,
producción y PR, y un cleanup de PR podía borrar la colección de otro entorno.
Las etiquetas Environment no aíslan el nombre de una colección.

## Decisión

Las colecciones nuevas se llaman `{project}-{environment}-event-{eventId}`.
SelfieIndexer, PhotoMatcher, borrado y purga resuelven el identificador con
el mismo helper de un argumento y la variable `FINDLY_COLLECTION_NAMESPACE`.
Cada módulo Terraform fija esa variable como `{project}-{environment}` y
limita sus permisos al ARN de esas colecciones en la región y cuenta actuales.
El root efímero exporta `collection_namespace`; los probes requieren
`EPHEMERAL_COLLECTION_NAMESPACE` igual al prefijo del PR. Las pruebas generan
nombres de evento únicos por ejecución como defensa adicional.

Sin namespace, AWS falla de forma cerrada. No se indexan ni buscan caras en
colecciones globales como fallback, ni se añaden ARNs legacy a IAM. La única
compatibilidad automática es local: `FINDLY_ALLOW_LEGACY_COLLECTIONS=1`
permite el nombre antiguo durante tests o contra Floci/loopback. AWS Lambda
rechaza esa excepción aunque esté definida la bandera.

## Compatibilidad y migración manual

Los objetos S3, eventId, token y claves DynamoDB no cambian por este ADR.
Las colecciones legacy se conservan: no se ejecuta DeleteCollection global,
no se migran embeddings automáticamente y no se afirma que un FaceId antiguo
sea válido en una colección nueva. Antes de habilitar un entorno con datos
anteriores, inventariar las colecciones y REG afectadas, confirmar ownership
de entorno/evento y acordar una migración con autorización y consentimiento.

La migración debe reinscribir a partir de selfies autorizadas aún retenidas,
guardar los FaceId/GSI actualizados y comprobar matching/borrado en el namespace
nuevo. Si no hay selfies o consentimiento válidos, decidir con la persona
responsable el borrado de los registros o una reinscripción. La retirada de
colecciones legacy requiere identificar todos sus consumidores y aprobar
los nombres exactos; un destroy de PR no autoriza eliminarlas. Las operaciones
de erasure de datos legacy siguen pendientes hasta ese procedimiento explícito.

## Verificación

Tests del helper comprueban separación del mismo eventId entre demo y PR,
rechazo de namespace ausente/inválido en AWS y compatibilidad local explícita.
Tests IaC comprueban namespace de las cuatro Lambdas y ARNs regionales/de cuenta
por entorno. Terraform y pruebas locales no acreditan la migración ni ejecución
AWS; ambas requieren revisión y evidencia independientes.

Validación de esta entrega: 262 tests en 36 archivos con Vitest 5, los gates
de líneas Lambda/shared-lib aprobados, TypeScript, ESLint, Markdown, formato
y TFLint. Se construyen y empaquetan nueve Lambdas. El probe de namespace
resuelve `findly-pr-70-event-evt-synthetic` sin llamadas AWS. Terraform validate
de las cinco raíces pasa con provider 6.66; mantiene avisos de deprecación de
hash_key/range_key de DynamoDB, ajenos al cambio. No se ejecutó apply ni
se modificaron políticas persistentes de la cuenta.
