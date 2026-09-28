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

No se ha ejecutado apply, plan contra estado AWS, aceptación efímera ni
publicación demo. La sesión AWS local está caducada. El alcance de permisos
a revisar está en `docs/runbooks/issue-70-aws-review.md`; el runner reproducible
está descrito en `docs/runbooks/issue-70-acceptance.md`.

La persona responsable aprobó las tres decisiones de continuación:
localizador sin TTL, selfies de una sola escritura y namespace por entorno.
ADR-013, ADR-014 y ADR-015 registran modelo, contrato, reconciliación y
compatibilidad. Su integración y validación se registran a continuación;
no se declara borrado AWS completo ni se cierran #10, #22 o #70 con mocks.

La PR permanece draft para revisión de código y CI ordinaria. Pasarla a ready
activaría provisión efímera y exige revisar antes los permisos y el plan.

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
autoriza esa llamada con Resource `*`. La lectura regional adicional permanece
pendiente de aprobación; recuperación usa el backend y plan PR #71 revisados.

Recuperación del intento 3 completada: 12 recursos restantes destruidos,
0 creados/cambiados; terraform state list devuelve vacío. No se han borrado
backend ni políticas del rol CI. El check continúa fallido hasta repetir
con la corrección y el permiso de lectura adicional aprobado.
