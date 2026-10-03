# ADR-017: Ciclo manual de demo permanente y roles independientes

## Contexto y autorización

La issue #15 requiere una demo persistente y dos acciones manuales para desplegar
y destruirla, sin modificar el CI efímero. El usuario aprobó el plan el
2026-10-03, incluidos los roles OIDC y un ciclo AWS con datos sintéticos.

## Decisión

- La demo usa su raíz Terraform y la clave `findly/demo/terraform.tfstate` del
  backend compartido existente. El backend, los roles operativos y sus políticas
  quedan fuera del inventario de destrucción. Sandbox, producción y PRs conservan
  sus raíces, permisos y ciclos independientes.
- Sólo `workflow_dispatch` desde `main` y los cuatro miembros acordados pueden
  operar demo. El control verifica actor original y actor de reejecución antes
  de credenciales. El environment `demo` debe permitir exclusivamente `main`.
- Los roles `findly-demo-deploy` y `findly-demo-destroy` usan audience exacta
  `sts.amazonaws.com` y subject
  `repo:upc-malvaviscos/findly:environment:demo`. No pueden modificar los roles
  operativos ni borrar el backend o su objeto de estado.
- Los documentos de políticas se generan desde
  `scripts/lib/demo-role-policies.mjs`; su configuración administrativa externa
  es reproducible con `scripts/configure-demo-roles.mjs`. Las políticas
  administradas permanecen junto a los roles y respetan los límites de AWS.
  Las acciones regionales usan ARN de `eu-west-1`; CloudFront es global.
- El despliegue rechaza borrados/reemplazos en el plan y aplica el plan exacto.
  La publicación y el smoke no destruyen el stack, tampoco si falla el smoke.
- La destrucción requiere escribir `DELETE FINDLY DEMO AND ALL ITS DATA`.
  Valida direcciones de recursos conocidas, nombres, etiquetas, cuenta, región
  y relaciones de propiedad. Rechaza inventarios ambiguos o recursos ajenos.
- Se mantiene `allow_bucket_destroy=false`, como ADR-009. El borrado de datos es
  explícito: revocar PUTs en los buckets, desactivar Scheduler y nuevas
  invocaciones Lambda, esperar el timeout máximo de las funciones ya en vuelo,
  limpiar objetos/versiones/marcadores y multipart uploads, y borrar únicamente
  colecciones etiquetadas del namespace `findly-demo-event-*`.
- Después de limpiar se refresca y valida un nuevo plan de destrucción antes de
  aplicarlo. Los errores de limpieza abortan; el siguiente run puede completar
  una destrucción parcial. El inventario temporal se conserva sólo en el runner.
- Deploy y destroy comparten `deployment-demo`, sin cancelación de runs activos,
  además del bloqueo nativo del estado. El CI efímero permanece intacto.
- La verificación final exige estado demo vacío, ausencia de los recursos
  inventariados y colecciones, y backend existente con sus protecciones.

## Identificadores generados y preparación inicial

API Gateway HTTP no hereda etiquetas a sus recursos hijos; OAC no soporta
etiquetas para limitar sus actualizaciones. Por ello se necesita conocer sus
identificadores para autorizar cambios de esos recursos sin usar comodines de
mutación para otros entornos.

El primer run con `prepare_demo_bindings=true` prepara exclusivamente API y web,
con sus dependencias, sin publicar ni afirmar que la demo esté completa. Después
la configuración administrativa enlaza los IDs comprobados por nombre y
propiedad. El run completo usa `prepare_demo_bindings=false`. Tras destruir y
recrear la demo se repite la preparación; los permisos conservan la separación
del backend y de otros entornos.

Los permisos de creación y lectura que AWS no permite limitar por identificador
previo se documentan explícitamente. Las mutaciones de OAC y de hijos HTTP API
quedan acotadas a los IDs revisados; no se amplían como solución a un fallo.

Referencias: [recursos y herencia de etiquetas de API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-tagging-supported-resources.html),
[autorización de CloudFront](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudfront.html).

## Etiquetado inicial de HTTP API: opción 2 aprobada

El usuario aprobó el 2026-10-03 permitir el POST de etiquetado inicial sobre
el ARN codificado `/tags/...%2Fv2%2Fapis%2F*`, sin la condición ApiName que AWS
rechazó en esa autorización dependiente. El permiso exige región `eu-west-1`
y las cuatro etiquetas de solicitud Project=findly, Environment=demo,
ManagedBy=Terraform y CostCenter=findly. La creación de API conserva la
condición de nombre `findly-demo-api`; las mutaciones posteriores de sus hijos
conservan los IDs exactos. El rol de destrucción no recibe este permiso.

Esta excepción permite etiquetar otras APIs HTTP de esa región si cumplen las
condiciones de solicitud. Es la ampliación explícitamente autorizada; no
autoriza modificar o destruir sus recursos hijos ni ampliar otros permisos.

La creación del stage requiere además una autorización dependiente
`apigateway:TagResource` sobre `/apis/{id}/stages`. El run real y el simulador
IAM demostraron que POST permitido no satisface ese control. El permiso se
concede sólo después de enlazar la API exacta, con región y las cuatro etiquetas
de solicitud de demo; nunca sobre stages de APIs arbitrarias.

## Evidencia

Publicación, recorrido real, limpieza, ausencia del inventario original y
recuperación/idempotencia verificados en AWS con datos sintéticos. La evidencia
de issue #15 detalla los runs, fallos, verificaciones y límites de cada prueba.
Las pruebas locales con mocks se mantienen como evidencia independiente.
