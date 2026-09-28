# #70: implementación integrada y validación local

Fecha: 2026-09-28. Base remota: main `3678a14`.

Tres agentes trabajaron en worktrees separados para inscripción pública,
borrado/retención y verificación. La integración reúne handlers, cliente,
Terraform, pruebas de aceptación y documentación de las decisiones aprobadas.

## Resultado local

- `npm run verify` tras integrar las tres decisiones: éxito; 38 archivos,
  293 tests con Vitest 5.0.1.
- Líneas: handlers Lambda 93,78 %, helpers Lambda 100 %, shared/lib 100 %.
  El gate se aplica por separado a Lambdas y shared/lib; global 81,34 %.
- `npm run test:e2e`: 12 pruebas pasan en Chromium, Firefox y WebKit.
- `WEB_PORT=4175 LOCAL_API_PORT=8790 FLOCI_PORT=4568 npm run test:e2e:local`:
  21 pruebas pasan; teardown de contenedores, volúmenes y red completado.
- Cinco roots Terraform válidos con AWS 6.66.0; avisos de deprecación
  hash_key/range_key conservados sin cambiar el esquema DynamoDB.
- Build web y nueve ZIP Lambda Node 24; audit de producción sin vulnerabilidades.

## Pendientes

Se han ejecutado plan, apply y teardown del entorno AWS efímero. Los permisos
del rol externo fueron aprobados y aplicados; sus límites están en `docs/runbooks/issue-70-aws-review.md`; el runner reproducible
está descrito en `docs/runbooks/issue-70-acceptance.md`.

La persona responsable aprobó las tres decisiones de continuación:
localizador sin TTL, selfies de una sola escritura y namespace por entorno.
ADR-013, ADR-014 y ADR-015 registran modelo, contrato, reconciliación y
compatibilidad. Su integración y validación se registran a continuación;
no se declara borrado AWS completo ni se cierran #10, #22 o #70 con mocks.

La PR está ready con auto-merge activado. Los gates ordinarios están verdes;
la aceptación AWS completa permanece pendiente. El primer intento del run
36475733713, head a7b5975, verificó FAILED/ENROLLED y falló en SearchFaces:
AWS no encontró el FaceId que IndexFaces acababa de devolver. Teardown exitoso.
Doce reproducciones aisladas con el mismo SDK y fixture ficticio pasaron; sus
colecciones temporales se eliminaron. Se repite el run sin cambiar el código.
No se atribuye el fallo a consistencia eventual ni concurrencia sin evidencia.

Las colecciones nuevas incluyen entorno y el runner exige ese namespace.
Las colecciones legacy se conservan; su inventario, migración y retirada
requieren una operación explícita. Ningún fallback AWS elimina colecciones
globales para aparentar compatibilidad.

CI detectó SC2155 mediante ShellCheck, ausente del entorno local. Los workflows
separan asignación de outputs y export para no ocultar fallos Terraform.
La provisión efímera aplica exactamente el archivo de plan inspeccionado.

## Corrección CI AWS: 2026-09-28

El intento 3 de 36464575720 pasó provisión y el recorrido desplegado de
organizador/galería sembrada. Inscripción pública falló porque el módulo
public-enrollment omitía FINDLY_COLLECTION_NAMESPACE; se añade local.prefix
y una regresión de configuración y transacción con entorno Lambda AWS.
La validación local pasa 294 tests en 38 archivos. Este resultado no acredita
aún inscripción, matching, purga, redrive o alarma desplegados.

El teardown se bloqueó al consultar un mapping después de eliminarlo: AWS
autoriza esa llamada con Resource `*`. La lectura regional adicional fue aprobada y aplicada como
findly-pr-71-approved-mapping-read; recuperación usa el backend y plan PR #71 revisados.

Recuperación del intento 3 completada: 12 recursos restantes destruidos,
0 creados/cambiados; terraform state list devuelve vacío. No se han borrado
backend ni políticas del rol CI. El check continúa fallido hasta repetir
con la corrección y el permiso de lectura adicional ya aprobado.

## Expresiones DynamoDB del smoke desplegado

El run 36471948755 (head 37a22c7) completó provisión y teardown, pero el
smoke falló con PUBLIC_SELFIE_POLLING_TIMEOUT. Las condiciones de SelfieIndexer
y PhotoMatcher usaban `ttl` sin alias, reservado por DynamoDB. Se corrigen a
`#ttl` con ExpressionAttributeNames y los mocks validan esta restricción que
antes omitían. Véase [palabras reservadas AWS](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ReservedWords.html).
La aceptación se repetirá con esta corrección; el timeout no se amplía para
ocultar la expresión inválida.

## Identificador temporal de Rekognition

Run 36473484010 (bf629de) alcanzó FAILED y ENROLLED reales, pero PhotoMatcher
registró ValidationException y no persistió matching. ExternalImageId usaba
PHOTO#; se corrige a PHOTO: y el test exige el patrón admitido por AWS.
Referencia: [IndexFaces](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_IndexFaces.html).
El teardown del run fue exitoso. La aceptación completa sigue pendiente de
repetir el smoke con la corrección.

## Preflight nativo del runner AWS

El segundo intento de 36475733713 pasó inscripción FAILED/ENROLLED, matching
S3, galería privada y borrado del FaceId indexado. Falló la ausencia de objeto
después del rechazo CORS desde el origen prohibido. Teardown exitoso.

La reproducción contra S3 real aisló el runner: con page.route activo del
documento, Chromium envió PUT sin preflight y bloqueó sólo la respuesta. El
objeto existía. Retirando esa ruta tras navegar, el origen prohibido fue
rechazado y el objeto no existía. Ambos objetos de diagnóstico se limpiaron.
La prueba local independiente confirmó OPTIONS sin routing, PUT con routing
y OPTIONS al retirarlo. Los dos runners ejecutan ahora page.unroute antes
de acceder a API/S3. Se conservan las aserciones de firma, CORS y ausencia;
no se cambia CORS, IAM ni el contrato de subida. La aceptación completa
del nuevo head aún requiere CI AWS.
