# Issue #166: barrera de foto frente a matching tardío

<!-- requirement: REQ-PHOTO-MATCHING-BARRIER -->

Fecha: 2026-10-23. Issue: [#166](https://github.com/upc-malvaviscos/findly/issues/166).
Plan aprobado por la persona responsable en esta sesión. Entornos: unitarias
con mocks y Floci local aislado; no se ejecutó AWS ni se desplegó el cambio.

## Protocolo implementado

1. DELETE confirma el tombstone antes de consultar espejos; usa `if_not_exists`
   para mantener la primera fecha y no actualiza TTL. Elimina metadatos de foto.
2. La transacción de `writeMatch` exige foto existente, sin `deletedAt` y con
   `ttl > :now`, además de las condiciones previas de inscripción/idempotencia.
3. Query fuerte y paginada descubre los commits anteriores a la barrera. Por
   página se completan todos los borrados directos antes de borrar espejos.
   `UnprocessedItems` se reintenta; un fallo deja claves inversas recuperables.
4. S3 se borra después por clave determinista. Un reintento repite la limpieza
   sin recrear datos ni ampliar la retención. Backfill filtra tombstones,
   TTL ausente/vencido y claves S3 ausentes/vacías.

Si el commit del matcher precede a la barrera, la lectura fuerte lo encuentra;
si sucede después, falla su ConditionCheck. Las escrituras match/espejo siguen
en una única transacción. No se añaden servicios, atributos nuevos, claves,
permisos IAM ni cambios de CI/CD.

## Matriz de verificación local

| Criterio                                               | Evidencia                                                                                 | Alcance                                                                         |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Match pausado tras resolver la cara, borrar y reanudar | `photoDeletionBarrier.test.ts`, middleware antes de enviar TransactWrite                  | Dos triggers; cero match/espejo, limpieza de caras simulada y objeto S3 ausente |
| Commit anterior a la barrera                           | Mismo archivo, match existente comprobado antes de DELETE                                 | Subida de foto y backfill; cleanup elimina ambos registros                      |
| Commit durante cleanup                                 | Query de DELETE pausada después del marcador, intento de `writeMatch`                     | Lectura real del marcador y condición transaccional emulada; cero match/espejo  |
| Commit posterior / redelivery                          | Reejecución de ambos triggers tras DELETE                                                 | Sin nueva coincidencia; backfill no llama a Rekognition para tombstones         |
| TTL lógico y fila aún existente                        | TTL vencido y tombstone probados directamente; TTL modificado después de resolver la cara | Rechazo en TransactWrite, sin esperar purga automática                          |
| Operación estable / reintento                          | `createPhotoUploads` con el mismo operationId tras DELETE                                 | `PHOTO_DELETED`, primera fecha y TTL conservados                                |
| Fallo parcial                                          | Interrupción tras un batch directo realmente confirmado, antes de espejos                 | Espejo conservado; reintento elimina residuos sin cambiar marcador/TTL          |
| Fallos de barrera y S3 / UnprocessedItems              | `tests/lambdas/adminEvents.test.ts`                                                       | Unitarias: orden, ausencia de cleanup si barrera falla, reintento de S3 y lotes |

La integración invoca explícitamente los handlers; no acredita notificaciones
nativas S3/SQS. Siembra inscripción antes de foto para el trigger de foto y
foto antes de inscripción para backfill. Rekognition devuelve rostros sintéticos
simulados; DynamoDB y S3 usan Floci 2.1.0, no mocks del SDK. Los tests se
ejecutan en un proyecto Compose aleatorio con puerto loopback efímero; el runner
elimina contenedor, red y volúmenes al terminar, también ante fallos.

Comandos reproducibles (Node 24 y npm 11):

```sh
npm run harness:check
npm run typecheck
npm exec -- vitest run --project=lambdas tests/lambdas/adminEvents.test.ts tests/lambdas/photoMatcher.test.ts tests/lambdas/registrationBackfillMatching.test.ts tests/lambdas/registrationBackfill.test.ts
npm run test:floci:integration
npm run verify
```

Resultados locales: harness, tipos y 77 unitarias focalizadas correctos.
Integración Floci: 27 pruebas en dos archivos (13 nuevas de foto y 14
preexistentes de selfie), correctas; limpieza Compose confirmada.
Imagen observada: `sha256:f5aa8c18302cedb4f2385f5c4e455b3efc77fee6bf7b6e5d1712b2817ba102db`.
La prueba de mutación temporal restauró exclusivamente la condición antigua de
existencia: ocho regresiones fallaron y el runner devolvió error. Se restauró
siempre el código aprobado antes de continuar. Esto demuestra sensibilidad a la
regresión; no acredita semántica de AWS real.

Durante E2E local apareció una carrera preexistente del test administrativo:
`toHaveValue(/evt-/)` podía aceptar el evento creado por otro test de navegador
antes de terminar su propio POST. El cambio posterior de evento desmontaba el
uploader y perdía el archivo seleccionado. Se corrige sólo el test, esperando la
respuesta del POST y el identificador exacto creado, sin esperas temporales,
reintentos adicionales ni ejecución serial. La primera ejecución tuvo 20/21
correctos; el escenario aislado sin cambios pasó. Un intento posterior falló antes de los tests por `ECONNRESET` de npm dentro
del contenedor y limpió sus recursos; se reintenta sin modificar configuración.
La ejecución paralela completa corregida pasó: 21/21 tests en Chromium,
Firefox y WebKit, con limpieza de contenedores/red/volúmenes confirmada.

Validación completa: `npm run verify` correcto, 719 pruebas en 70 archivos,
coverage vigente superado, lint/tipos/build de web y 12 Lambdas, validación
Terraform y tests de hosting/correo/findly-stack, cero vulnerabilidades de
producción, trazabilidad de 19 requisitos. `npm run test:e2e`: 42 correctas y
3 omitidas por la suite existente (no se añaden omisiones).

## Límites conservados y pendientes

- `:now` se muestrea al construir la transacción en la Lambda. DynamoDB compara
  atómicamente los atributos contra ese valor; no proporciona una función de
  reloj servidor en la condición ni una garantía de tiempo real sin demora.
- Una URL PUT ya emitida no se revoca; un PUT tardío puede recrear un objeto S3
  hasta la limpieza por retención. Una petición de subida iniciada antes del
  marcador puede terminar de firmar. Mientras exista el tombstone no habilita
  matches. No se garantiza rechazo perpetuo tras purgar físicamente el marcador.
- Fallos parciales convergen al reintentar DELETE; no se introduce reconciliador
  automático. La purga concurrente de un espejo por su TTL no se controla aquí.
- Una reentrega S3 real puede fallar al indexar un objeto ya borrado y seguir la
  política SQS/DLQ existente. Los rostros de integración son simulados: no prueba
  el contrato de error ni el borrado de caras de Rekognition real.
- Borrado completo de evento con backfill/correo en curso queda fuera de alcance.
  Se conservan las limitaciones históricas de matches sin espejo de ADR-022.
- Aceptación AWS autorizada, recursos sintéticos, carreras repetidas y limpieza
  en servicios reales: pendiente. No se reutiliza el benchmark histórico de #89
  como prueba de este protocolo. La issue permanece abierta.
- Se sincronizan specs 05/21/23, ADR-022/024 y memoria académica fuente. La
  referencia a spec 24 de la issue no corresponde a un archivo existente;
  el contrato aplicable es spec 05 junto con ADR-024. No se recompila el PDF
  académico ni se actualiza la memoria personal de Codex.

## Presentación de defensa

Se revisan las 26 diapositivas y sus notas en la
[presentación nativa](https://docs.google.com/presentation/d/143oPq7nSXOUebQwoOGgJsPgO7xPQTFxQb2_xlG_EoyU/edit).
Se actualizaron las diapositivas 4 (alcance sin menores), 24 (cambio local y
pendientes) y 26 (siguientes pasos), con las notas de las dos últimas. Readback
confirmado: sólo seis objetos de texto cambiaron; se conservaron 26 slides,
estilos y geometría. La revisión distingue código desplegado, pruebas locales
de #166 y aceptación AWS pendiente. Notas: orden de barrera, descubribilidad de
espejos, reloj muestreado, PUT previo y duración del marcador.

Exportación PDF completa y render de las 26 páginas revisados antes y después;
sin desbordamientos nuevos. PDF final: 653.757 bytes,
SHA-256 `7a6d8334e08e6a812d0b9f7ce60f161fb824377bcffa8863de9a79088dfedce1`.
No se cambian las métricas históricas ni se presenta #166 como desplegada.
