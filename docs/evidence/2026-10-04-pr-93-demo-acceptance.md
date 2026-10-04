# Seguimiento de aceptación de PR #93 — 2026-10-04

## Alcance autorizado

Completar las actividades posteriores al merge de PR #93: revisar/aplicar la
configuración externa de roles demo, publicar la demo, verificar las cinco
series de errores de inscripción, destruir todo el stack demo y sus datos
conservando el backend, y sincronizar #22/#13/#70. Imágenes, eventos e
identidades exclusivamente sintéticos.

## Preparación verificada

- `main@1d5eb821` contiene PR #93 y su corrección de aceptación efímera.
- El estado `findly/demo/terraform.tfstate` tenía cero recursos.
- Se registraron metadatos de 41 objetos de estado ajenos para compararlos al
  finalizar. No se publican estados, outputs sensibles ni credenciales.
- Revisión de políticas activas frente al generador: se añade telemetría a los
  inventarios exactos de Lambda/IAM; deploy recibe `cloudwatch:GetMetricData`
  de sólo lectura limitado a `eu-west-1`. Destroy no recibe esa lectura.
- Configuración aplicada y simulador IAM: `GetMetricData` permitido en deploy.
- Preparación API/web: [37197764514](https://github.com/upc-malvaviscos/findly/actions/runs/37197764514),
  éxito; siete recursos creados y sin borrados.
- Se revisan y aplican bindings exactos de API/OAC/distribución después de la
  preparación; sin comodines nuevos para mutaciones de otros entornos.

## Corrección del inventario de destrucción

[PR #94](https://github.com/upc-malvaviscos/findly/pull/94) incorpora la clave
`telemetry`, omitida en `demo-controls.mjs` tras PR #93. La regresión compara
los handlers declarados por Terraform con el validador y rechaza claves
desconocidas. Se conservan backend, etiquetas, relaciones de propiedad,
cuenta, región y lista de actores. No cambian los permisos del CI efímero.

Validación local completa mediante el hook pre-push: 354 pruebas en 43 archivos,
cinco raíces Terraform y ocho planes mock; lint, tipos, build, seguridad y sync
correctos. `TF_DATA_DIR` aislado del backend local ajeno. CI E2E local correcto.
El CI de PR #94 pasó 15 pruebas de navegador, 14 de integración Floci y 21 del
recorrido E2E local completo.

## Demo publicada y métricas verificadas

- Despliegue completo/smoke: [37198156959](https://github.com/upc-malvaviscos/findly/actions/runs/37198156959),
  éxito. Añade 107 recursos a los siete preparados (114 en total), publica la
  SPA con HTTPS/OAC y ejecuta Cognito, creación de evento, inscripción/PUT/CORS,
  indexación, subida admin, matching, imagen de galería y errores sintéticos.
- El smoke exige registro inválido 400, polling con token ajeno 404, tres
  reportes 204 y rechazo 400 del reporte con campo adicional; después consulta
  las cinco series con `GetMetricData` dentro de su límite original de 6 min.
- Una lectura posterior confirma datos a las 11:20 UTC: RegistrationErrors=2,
  PollingErrors=3; ClientEnrollmentErrors=1 por cada Stage registration/upload/polling.
- Lecturas AWS del handler de telemetría: sólo CreateLogStream/PutLogEvents,
  ningún managed policy adjunto, retención 14 días, ráfaga 10 y 5 peticiones/s,
  y Stage como única dimensión del metric filter.
- Logs del handler: siete registros JSON, tres reportes válidos y ningún campo
  registrationId, galleryToken, email, faceId o uploadUrl. El cuarto reporte no
  genera un evento client_enrollment_error.
- Tras el despliegue se revisa y aplica el binding exacto del pool Cognito para
  verificar su ausencia después del borrado; no se amplían permisos de otros pools.
- El simulador confirma explicitDeny de DeleteBucket para el backend compartido.

## Destrucción y sincronización

- Aceptación efímera de PR #94: [37197959200](https://github.com/upc-malvaviscos/findly/actions/runs/37197959200),
  éxito; recorrido completo y destrucción de 111 recursos. PR #94 fusionada
  con todos los controles correctos en `df175bc` a las 11:33:28 UTC.
- Borrado manual de demo: [37199188358](https://github.com/upc-malvaviscos/findly/actions/runs/37199188358),
  éxito sobre `df175bc`. El inventario acepta 114 recursos, dos buckets y una
  colección dinámica. Tras detener productores y esperar 310 segundos,
  limpia datos y aplica el plan de borrado. El verificador exige ausencia del
  stack y colecciones, estado vacío y backend preservado.
- Lecturas posteriores: demo y PR #94 con cero recursos; los 41 objetos de
  estado ajenos capturados inicialmente conservan ETag, tamaño y fecha de
  modificación. El backend mantiene versionado Enabled, los cuatro bloqueos
  de acceso público y cifrado AES256. Los roles operativos permanecen.

## Resultado y límites

Se completan los cuatro pendientes de PR #93 y el criterio de métricas de #22:
roles revisados/aplicados, demo publicada y probada, destrucción manual y
evidencia/trazabilidad. README, spec 18, ADR-018, paper, runbook y evidencias de
las issues #15/#22/#13 se actualizan conjuntamente. El tracker #70 distingue esta aceptación del
trabajo de FinOps y del nuevo backlog MVP.

La evidencia efímera de PR #93 en run 37195275576 acredita las llamadas al
handler, logs de las 13 Lambdas y teardown de 111 recursos. No acredita por sí
sola las cinco series en demo. Budgets/correo real permanecen fuera de este
ciclo; no se debe cerrar #13 por las métricas de #22. Tampoco se implementan
las nuevas funciones de #86–#89 ni se resuelve la decisión arquitectónica #49.
