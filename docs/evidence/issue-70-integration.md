# #70: implementación integrada y validación local

Fecha: 2026-09-28. Base remota: main `3678a14`.

Tres agentes trabajaron en worktrees separados para inscripción pública,
borrado/retención y verificación. La integración reúne handlers, cliente,
Terraform, pruebas de aceptación y documentación de las decisiones aprobadas.

## Resultado local

- `npm run verify`: éxito; pre-push final 35 archivos, 246 tests con Vitest 5.0.1.
- Líneas: handlers Lambda 97,36 %, helpers Lambda 100 %, shared/lib 100 %.
  El gate se aplica por separado a Lambdas y shared/lib; global 80,44 %.
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

La purga si REG desaparece por TTL y los FaceIds huérfanos tras indexación
concurrente requieren una decisión de modelo/reconciliación. Un localizador
sin TTL y candidatos está pendiente de aprobación; persistir candidatos no
elimina por sí solo la ventana de fallo entre IndexFaces y su escritura.
No se declara borrado completo ni se cierran #10, #22 o #70 con pruebas locales.

La PR permanece draft para revisión de código y CI ordinaria. Pasarla a ready
activaría provisión efímera y exige revisar antes los permisos y el plan.

Revisión final: el nombre Rekognition actual no incluye entorno. Eventos
idénticos podrían compartir colección entre stacks; namespace y compatibilidad
legacy requieren aprobación antes de ejecutar AWS. El runner queda bloqueado.

CI detectó SC2155 mediante ShellCheck, ausente del entorno local. Los workflows
separan asignación de outputs y export para no ocultar fallos Terraform.
La provisión efímera aplica exactamente el archivo de plan inspeccionado.
