# Issue #15: demo permanente con OIDC y destrucción manual

## Estado verificable

Implementación en curso en `feature/issue-15-permanent-demo`. El usuario aprobó
el plan y el ciclo AWS el 2026-10-03. La PR #90 ya mergeada habilitó HTTPS sin
dominio propio; su CI efímero no acreditó la demo permanente.

Esta entrega añade controles de actores original/reejecución, environment y rama,
roles independientes, dos workflows manuales con concurrencia compartida,
inventario de destrucción, quiescencia, limpieza de versiones/multipart y
colecciones, y comprobación de ausencia después de destruir.

## Configuración externa ejecutada

- Environment `demo` creado, con `custom_branch_policies=true` y una única regla
  de tipo branch: `main`. Regla comprobada mediante la API de GitHub.
- Seis variables no secretas del environment configuradas: cuenta, backend,
  nombres exactos de buckets y ARN de los roles deploy/destroy. No se añadieron
  credenciales estáticas. Las variables del CI efímero permanecen intactas.
- Los roles independientes `findly-demo-deploy` y `findly-demo-destroy` y sus
  políticas administradas se configuraron con la sesión administrativa temporal,
  usando el script versionado. Trust acotado al subject del environment demo.
  Los IDs de API/OAC quedan pendientes de la preparación inicial del stack.
- El backend compartido existente no se modificó. No existía objeto de estado
  bajo `findly/demo/` antes de comenzar.

## Validación local

`npm run verify` pasó con 330 pruebas en 41 archivos, TypeScript, lint,
actionlint, Terraform fmt/validate/tflint, 8 pruebas Terraform con proveedor
simulado, empaquetado de Lambda y auditoría de dependencias de producción.
La verificación final del commit incluye rechazo de roles operativos, workspace
ajeno y permisos de lectura por IDs exactos tras la desaparición de etiquetas.

Las pruebas específicas cubren actores, reejecuciones, confirmación exacta,
configuración externa arbitraria, backend y recursos ajenos, errores de limpieza
y recuperación parcial, versiones/marcadores/multipart, paginación de colecciones,
parada de productores y timeout de funciones, trust y límites de políticas.

La validación de solo lectura con Access Analyzer no se ejecutó: la revisión
automática de permisos agotó dos veces su plazo; el intento dentro del sandbox
no pudo conectar al endpoint. Esto no se presenta como una validación de políticas
realizada. Las políticas sí fueron aceptadas al configurar IAM; queda pendiente
probar sus permisos efectivos con los workflows desplegados.

## Aceptación AWS pendiente

Pendientes de publicar y mergear la PR de implementación, preparar API/web,
enlazar IDs, desplegar la SPA, probar el recorrido real y ejecutar el workflow
manual de destrucción. No marcar esos criterios como completados hasta registrar
los runs y comprobar stack/colecciones ausentes y backend/otros entornos intactos.

Referencias: spec 14, ADR-017 y `docs/runbooks/permanent-demo.md`.
