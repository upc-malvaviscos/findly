# Issue #15: demo permanente con OIDC y destrucción manual

## Estado verificable

Implementación principal fusionada en la
[PR #91](https://github.com/upc-malvaviscos/findly/pull/91).
Aceptación y correcciones en `fix/issue-15-demo-aws-acceptance`. El usuario aprobó
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
- Permisos de repositorio consultados para los cuatro actores: `anyulled`
  es admin; `orLuzuriaga`, `raati5674` y `surinyach` tienen write. Pueden ejecutar
  workflows manuales sin modificar membresía ni permisos del repositorio.
- Los roles independientes `findly-demo-deploy` y `findly-demo-destroy` y sus
  políticas administradas se configuraron con la sesión administrativa temporal,
  usando el script versionado. Trust acotado al subject del environment demo.
  OAC/distribución enlazados a sus IDs exactos tras la preparación parcial;
  el ID de API sigue pendiente porque CreateApi fue rechazado.
- El backend compartido existente no se modificó. No existía objeto de estado
  bajo `findly/demo/` antes de comenzar.

## Validación local

`npm run verify` pasó con 333 pruebas en 41 archivos, TypeScript, lint,
actionlint, Terraform fmt/validate/tflint, 8 pruebas Terraform con proveedor
simulado, empaquetado de Lambda y auditoría de dependencias de producción.
La verificación final del commit incluye rechazo de roles operativos, workspace
ajeno y permisos de lectura por IDs exactos tras la desaparición de etiquetas.
El contrato del job de autorización se ejecuta también contra el guardián real,
incluido el workspace fijo antes de obtener credenciales.

Las pruebas específicas cubren actores, reejecuciones, confirmación exacta,
configuración externa arbitraria, backend y recursos ajenos, errores de limpieza
y recuperación parcial, versiones/marcadores/multipart, paginación de colecciones,
parada de productores y timeout de funciones, trust y límites de políticas.

La validación de solo lectura con Access Analyzer no se ejecutó: la revisión
automática de permisos agotó dos veces su plazo; el intento dentro del sandbox
no pudo conectar al endpoint. Esto no se presenta como una validación de políticas
realizada. Las políticas sí fueron aceptadas al configurar IAM; queda pendiente
probar sus permisos efectivos con los workflows desplegados.

## Rechazo desplegado antes de AWS

El [run 37133964980](https://github.com/upc-malvaviscos/findly/actions/runs/37133964980)
solicitó un plan sin apply desde `feature/issue-15-permanent-demo`. GitHub rechazó
la rama por las reglas del environment demo. `authorize` terminó sin ejecutar
pasos y `deploy` quedó omitido: no se asumió ningún rol ni se modificó AWS.

Antes del ciclo se registraron sólo metadatos de 38 objetos de estado ajenos a demo,
versionado, cifrado y bloqueo público del backend, para comparar tras el borrado.
El registro temporal no contiene el estado ni se adjunta al repositorio.

## Preparación AWS y recuperación

La PR #91 se fusionó automáticamente el 2026-10-03 a las 16:10:34 UTC
(`d7dddefe98eb10c2a2aad488973db75bb231bca2`). El CI completo y los dos ciclos
efímeros de la PR terminaron con aceptación y destrucción correctas:
[37133170350](https://github.com/upc-malvaviscos/findly/actions/runs/37133170350) y
[37133932747](https://github.com/upc-malvaviscos/findly/actions/runs/37133932747).

El [run 37135940799](https://github.com/upc-malvaviscos/findly/actions/runs/37135940799)
de preparación desde main autorizó actores/OIDC y guardó el estado parcial.
Su primer intento falló al consultar `s3:GetBucketAcl` del bucket web: no se
oculta ni se contabiliza como aceptación correcta. Se contrastó el
[refresh de aws_s3_bucket del proveedor 6.66.0](https://github.com/hashicorp/terraform-provider-aws/blob/v6.66.0/internal/service/s3/bucket.go)
y se añadieron sus lecturas exactas únicamente a los dos buckets de demo, para
deploy y destroy. El configurador actualizó las políticas operativas y se
reejecutó sólo el job fallido, con el guardián de reautorización previo a AWS.

El segundo intento fue rechazado por el guardián de reemplazos: el bucket había
quedado tainted tras el fallo inicial de lectura. Se recuperó con la acción
manual de destrucción, sin untaint ni excepciones al guardián. El
[run 37136349607](https://github.com/upc-malvaviscos/findly/actions/runs/37136349607)
terminó correctamente y verificó estado vacío, recursos del stack parcial
ausentes y backend conservado.

El [run 37136524071](https://github.com/upc-malvaviscos/findly/actions/runs/37136524071)
creó bucket web/OAC/CloudFront y falló en CreateApi: AWS exige POST sobre el
recurso de etiquetado inicial `.../tags/...%2Fv2%2Fapis%2F*`. Una regla con
las mismas restricciones de nombre y etiquetas se aplicó y el job fallido se
reejecutó; también fue rechazado. No se presenta ese intento como aceptación.
La regla experimental que también fue rechazada se retiró del configurador y
de IAM mientras se esperaba la decisión. El usuario aprobó explícitamente la
opción 2: permitir el etiquetado inicial sin condición de nombre, manteniendo
región y cuatro etiquetas de solicitud de demo. ADR-017 documenta el alcance
adicional autorizado y el test de políticas verifica esas condiciones y que
el rol de destrucción no recibe el permiso.
El configurador aplicó la regla aprobada y se relanzó el job fallido del run
37136524071 (intento 3). Su resultado sigue pendiente de verificar; no acredita
todavía API funcional, publicación ni aceptación completa.

La revisión del proveedor identificó también lecturas obligatorias
`GetFunctionCodeSigningConfig`, `ListVersionsByFunction` y `GetUserPoolMfaConfig`.
Se acotaron a las funciones de demo y al pool con etiquetas de propiedad, sin
ampliar mutaciones.

## Aceptación AWS pendiente

Pendientes de resolver la autorización inicial de API, publicar sus correcciones,
enlazar su ID, desplegar la SPA, probar el recorrido real y ejecutar el workflow
manual de destrucción completo. No marcar esos criterios como completados hasta registrar
los runs y comprobar stack/colecciones ausentes y backend/otros entornos intactos.

Referencias: spec 14, ADR-017 y `docs/runbooks/permanent-demo.md`.
