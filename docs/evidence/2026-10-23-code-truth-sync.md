# Sincronización con el código de Findly — 2026-10-23

<!-- requirement: REQ-PAPER-RUNBOOK -->

## Fuente y alcance

Instantánea de código: `7fc0376` de `origin/main`. El responsable confirma
que todo el código actual está desplegado; esta afirmación se atribuye a su
confirmación, no a una inspección AWS realizada hoy. La auditoría consulta
handlers, contratos, Terraform, pruebas, specs, ADRs, memoria y cuerpos y
comentarios de issues GitHub. No ejecuta AWS, envíos, cambios DNS ni despliegues.

Las evidencias fechadas conservan su valor histórico: no se sobrescriben los
resultados originales para fingir una ejecución nueva. Las síntesis actuales
corrigen los presentes desactualizados y distinguen código, despliegue,
aceptación histórica y trabajo futuro.

## Resultado contrastado

| Aspecto                   | Código actual y evidencia                                                                                                                                                         | Estado o límite                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Borrado por lotes         | `adminEvents.ts::batchDeleteItems`: grupos de 25, `BatchWriteCommand`, reintento de `UnprocessedItems`; `admin-api/main.tf`: 60 s. #89 registra aceptación AWS 100/1.000 matches. | Implementado y desplegado; no deuda pendiente.                                                                                         |
| Integridad match/espejo   | `lib/matching.ts::writeMatch`: transacción conjunta y condición de existencia de Photo.                                                                                           | Corrección histórica PR #144 implementada; la condición solo acredita existencia física.                                               |
| Tombstone de fotografía   | `deleteEventPhoto` conserva PK y `deletedAt`, retira `s3Key`; #121/ADR-024.                                                                                                       | `attribute_exists(PK)` no rechaza tombstone ni TTL lógico. Riesgo #166 por código; sin reproducción AWS nueva.                         |
| Visibilidad y backfill    | Galería solicita `s3Key` y omite filas sin esa clave; backfill comprueba TTL de Photo y pasa `s3Key`, sin filtro expreso `deletedAt`.                                             | Ocultar la foto no prueba ausencia de matches/espejos huérfanos. #166 exige probar ventanas antes/durante/después del borrado.         |
| Matching en ambos órdenes | Núcleo común, backfill SQS paginado tras ENROLLED y escritura idempotente; evidencia #87.                                                                                         | Implementado. Encolado best-effort; Transactional Outbox no implementado.                                                              |
| Persistencia              | Match inverso `PHOTO#eventId#photoId/MATCH#registrationId`, ADR-022, benchmark #49.                                                                                               | DynamoDB confirmado, #49 cerrada; ninguna migración RDS pendiente aprobada.                                                            |
| Administración            | Edición, paginación, JWT y retención prospectiva con aceptaciones PR #146/#147/#148.                                                                                              | #89 cerrada; no se reabre por riesgo posterior a su entrega.                                                                           |
| Reintento de subidas      | Identificador estable, reconciliación `HeadObject`, tres subidas simultáneas y tombstone; #121.                                                                                   | Implementado; renovación no prolonga TTL ni confirma desde el porcentaje de progreso.                                                  |
| SES                       | Nueve escenarios AWS 38950320818; `single-recipient` 38955016584 acredita un buzón, cabeceras y apertura.                                                                         | Implementación #86 cerrada; #98 reabierta: falta evidencia de segundo proveedor. Autenticación no equivale a recepción multiproveedor. |

## Sincronización y seguimiento

- Memoria académica y capítulos fuente actualizados con el código vigente;
  diapositivas y notas se sincronizan conservando a Santiago en core/demo y a
  Anyul al final, en validación/datos/Fase II/cierre.
- README, índice de specs, specs 02/17/20/21/23, ADR-022/024 y evidencias
  #49/#89/#98 distinguen estados actuales e historia.
- [#49](https://github.com/upc-malvaviscos/findly/issues/49) y
  [#89](https://github.com/upc-malvaviscos/findly/issues/89): cuerpos corregidos,
  cierres históricos conservados.
- [#98](https://github.com/upc-malvaviscos/findly/issues/98): reabierta,
  solo criterio original de recepción en dos proveedores desmarcado.
- [#166](https://github.com/upc-malvaviscos/findly/issues/166): investigación
  acotada de barrera temporal, tombstone y TTL lógico; exige regresiones y
  aceptación AWS futura autorizada. No implementa una solución en esta tarea.

## Validación de esta sincronización

Validación local bajo Node.js 24.20.0 y npm 11.19.0:

- `npm run harness:check`: correcto.
- `npm run verify`: correcto; 70 archivos de prueba y 710 pruebas aprobadas,
  lint, tipado, compilación, 12 artefactos Lambda verificados, formato y
  validación Terraform, contratos de hosting/correo/stack, auditoría de
  producción sin vulnerabilidades y trazabilidad de 18 requisitos.
- `npm run lint:markdown`: 130 archivos sin errores; `git diff --check` correcto.
- El primer intento aislado de `verify` no pudo iniciar el plugin de TFLint;
  se repitió completo con ejecución autorizada fuera del aislamiento y pasó,
  sin omitir ni debilitar comprobaciones.
- No se recompiló el PDF académico: faltan `pandoc`, `pandoc-crossref` y
  `xelatex` en este entorno. Se actualizan las fuentes Markdown, sin declarar
  una compilación que no se ha ejecutado.

La [presentación nativa de la defensa](https://docs.google.com/presentation/d/143oPq7nSXOUebQwoOGgJsPgO7xPQTFxQb2_xlG_EoyU)
conserva 26 diapositivas y su orden y reparto. Se actualizaron 12 diapositivas
visibles y las 26 notas didácticas; la lectura posterior confirmó su contenido.
El PDF exportado contiene 26 páginas, revisadas visualmente sin recortes ni
desbordamientos observados. Revisión comprobada: `zgfDpzVDEgFWnA`.

No se presenta la validación estática/local ni el render de la presentación
como aceptación AWS nueva. La PR y sus checks remotos se enlazan desde las
issues asociadas al finalizar la sincronización.
