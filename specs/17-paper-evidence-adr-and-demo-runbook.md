# 17 - Memoria técnica, evidencias, ADRs y Runbook de demostración

## Objetivo

Estructurar la documentación técnica y académica del proyecto en la carpeta `docs/paper/`, manteniendo la trazabilidad con los registros de arquitectura (ADRs), catálogo de evidencias y un runbook ejecutable paso a paso para la demostración del sistema.

## Alineación con AWS Well-Architected Framework

- **Excelencia Operativa**: Runbook ejecutable paso a paso para la demostración del sistema y trazabilidad completa de evidencias.

## Estructura de Documentación y Memoria (`docs/paper/`)

- Capítulos del `00` al `11` cubriendo alcance, viabilidad, arquitectura C4, seguridad, FinOps, pruebas y conclusiones.

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Actualizar la Memoria del Proyecto

- Asegúrate de incorporar la decisión ADR-001 (React + Vite) en el capítulo `docs/paper/04-arquitectura-y-decisiones.md`.

### Paso 2: Ejecutar el Runbook de Demostración

- Sigue la secuencia: Despliegue `demo` -> Inscripción -> Carga Masiva Admin -> Galería Privada -> Derecho al Olvido -> Teardown.

## Errores Comunes a Evitar (Pitfalls)

- ❌ **ERROR**: Dejar afirmaciones en la memoria técnica sin enlace a una evidencia en `docs/evidence/`.
  - _Solución_: Cada métrica o resultado debe enlazar a su captura o log de comprobación.

## Lista de Verificación Pre-PR (Junior Checklist)

- [x] La memoria del proyecto refleja la pila tecnológica actual (React + Vite + AWS Serverless).
      _(Capítulos 03/08/09/10/11 escritos con evidencia enlazada; 04-07 ya
      sincronizados por trabajo previo. Issue #18.)_
- [x] El runbook de demo puede ser ejecutado por una persona ajena al equipo,
      **con alcance explícito por nivel**.
      _(`docs/runbooks/demo-runbook.md`: el nivel 1, local con Floci, es
      ejecutable hoy sin cuenta AWS ni acceso al repositorio privado; el
      nivel 2, AWS efímero real, sólo es reproducible desde una pull request
      de este repositorio; el nivel 3, `demo` persistente, sigue bloqueado.
      No se presenta el nivel 1 como equivalente a una demo AWS publicada.)_

## Límite de verificación

La auditoría #70 separa la documentación de la demo ejecutada. La publicación
completa depende de #15/#61 y del consentimiento, matching, galería y DELETE
desplegados. No usar dev:aws-destroy contra demo; conservar
allow_bucket_destroy=false y acordar objetivos concretos de limpieza.

## Estado de implementación (issue #18)

Capítulos 03/08/09/10/11 de `docs/paper/` y `docs/runbooks/demo-runbook.md`
escritos con evidencia enlazada. El consentimiento, matching, galería y
DELETE ya están verificados en AWS real por la aceptación de #70/PR #71
(capítulo 8). El bloqueador original — bootstrap del estado Terraform y
despliegue manual (#15/#61) — ya se resolvió: #61 se verificó en AWS real
(PR #83) y #15 publicó y probó una SPA `demo` persistente (PR #92),
desactivada después por control de coste. Capítulos 08/09 se sincronizaron
el 2026-10-15 con los cierres reales de #7/#10/#11/#13/#15/#22 y con las
nuevas issues #88/#98/#105/#107/#125, y de nuevo el 2026-10-21 con el cierre
de las cuatro issues que mantenían abierta esta memoria: la decisión
DynamoDB y su benchmark de fan-out real (issue #49, PR #141), el correo de
galería (issue #86, PR #142), el matching convergente (issue #87, PR 129 y 139) y la edición/borrado administrativo de eventos y fotos (issue #89, PR
120, 147 y 148) — además de las issues #70, #98, #105 y #121, cerradas en
el mismo periodo. Esta sincronización documenta también dos
hallazgos históricos de #49 (timeout y ausencia física de foto), corregidos
en PR #143/#144. La revisión del 2026-10-23 distingue esas correcciones del
riesgo posterior de tombstone/TTL lógico (#166) y corrige el cierre de #98:
falta recepción/apertura en un segundo proveedor. Outbox permanece futuro. Evidencia:
[`docs/evidence/issue-18-paper-runbook.md`](../docs/evidence/issue-18-paper-runbook.md).
Esta issue se cierra con esta entrega.

<!-- requirement: REQ-PAPER-RUNBOOK -->

## Publicación automática de la memoria académica (#186)

<!-- requirement: REQ-MEMORIA-PDF-RELEASE -->

Alcance aprobado en [#186](https://github.com/upc-malvaviscos/findly/issues/186),
[ADR-027](../docs/adr/ADR-027-memoria-pdf-releases.md) y
[evidencia](../docs/evidence/issue-186-memoria-pdf-releases.md):

- Compilar `memoria-postgrado.md` con portada e imágenes versionadas mediante
  Pandoc, pandoc-crossref y XeLaTeX de una imagen fijada por digest.
- En PR, validar la compilación sin publicar previews; tras un merge relevante
  a `main`, publicar `memoria.pdf` como asset de GitHub Release. Conservar push
  y cubrir auto-merges con callbacks de checks, ya que el token del bot suprime push.
- Resolver el origen con código de `main`, PR integrada, SHA exacto, ascendencia
  en main y archivos relevantes completos. Hacer checkout sólo de main y usar
  su Makefile/toolchain; exportar sólo datos del commit seleccionado, rechazando
  symlinks, sin ejecutar scripts históricos ni descargar artefactos de PR.
  Deduplicar por commit antes de volver a compilar y registrar ambos SHAs.
- Ofrecer recuperación manual limitada a una PR integrada en main; no confundir
  esa ejecución manual con evidencia de la ruta automática.
- Disparar sólo por entradas de la memoria y configuración/herramientas PDF,
  sin vincular la publicación a cualquier Markdown del repositorio.
- Conservar releases publicadas con tags `memoria-YYYY-MM-DD_HH-mm`, zona
  `Europe/Madrid`, reloj de 24 horas, sin commit en el nombre.
- Serializar con la cola estándar aprobada: una activa y una pendiente; una
  nueva ejecución puede reemplazar la pendiente en una ráfaga de merges.
- No sobrescribir tags/releases; esperar otro minuto ante colisiones y
  reanudar el borrador de un rerun. Publicar únicamente tras subir el PDF.
- No versionar PDFs, crear previews descargables, cambiar el ruleset ni
  desplegar AWS. Limitar `contents: write` al job de publicación.

### Aceptación específica

- [x] Compilación real y revisión visual documentadas; checks locales completos.
- [x] Check PDF remoto de PR satisfactorio, sin publicación.
- [ ] Primera release real posterior al merge: tag/commit/hora/descarga verificados.
- [x] Issue sincronizada con PR, ejecuciones, evidencia y pendientes.

No se declara completada la aceptación remota mediante pruebas simuladas de
GitHub ni mediante la compilación local.

Trazabilidad `REQ-PAPER-RUNBOOK`: [#18](https://github.com/upc-malvaviscos/findly/issues/18) · [evidencia](../docs/evidence/issue-18-paper-runbook.md).

Instantánea vigente: [sincronización del 2026-10-23](../docs/evidence/2026-10-23-code-truth-sync.md).

Actualización posterior a #168: la memoria académica explica el ítem espejo en
la sección DynamoDB y conserva el historial de correo en un anexo de
trazabilidad, separado del flujo arquitectónico. #168 está integrada y su
smoke AWS efímero y teardown pasaron (147 recursos Terraform destruidos);
los ensayos AWS específicos de carreras/TTL y su publicación permanente no se
presentan como completados. Véase la
[evidencia de #166](../docs/evidence/issue-166-photo-matching-barrier.md).
