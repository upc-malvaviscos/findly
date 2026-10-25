# Revisión académica de la memoria — issue #192

<!-- requirement: REQ-PAPER-RUNBOOK -->

## Alcance y procedencia

Revisión documental del 25–26 de octubre de 2026, solicitada por el equipo tras
una evaluación académica orientativa. Se parte de `origin/main` en `075f76c`,
con rama `docs/memoria-academic-review`. Se preservan los archivos `.DS_Store`
locales ajenos al cambio. No se modifica código de aplicación, IAM, DNS ni
workflows operativos.

La investigación se reparte entre tres subagentes con modelo ligero para
fuentes/costes, evidencias/contribuciones y diagramas. El agente principal
contrasta e integra los resultados y verifica los artefactos. Una respuesta
de un subagente no se usa como sustituto de una fuente verificable.

## Resultados documentales

- Resumen académico, comparación breve de alternativas y citas de fuentes
  primarias consultadas el 25 de octubre de 2026.
- Matriz central de requisitos con resultados, entornos y pendientes.
- Análisis de suplantación, enlaces portadores, terceros en fotos grupales,
  indexación temporal y administración compartida del entorno.
- Distinción entre S3 Object Lock y `use_lockfile` de Terraform; corrección
  de la exclusión de menores y de garantías absolutas de autorización.
- Cronograma de hitos y contribuciones concretas por PR de los cuatro
  integrantes. No hay registro de horas consolidado: no se deduce esfuerzo
  personal del número de commits.
- Figuras de contexto y contenedores C4, infraestructura, secuencia y CI/CD
  derivadas de código, módulos y workflows existentes.
- Modelo FinOps con supuestos explícitos; estimación y factura real no se
  consideran equivalentes.

## Corrección de evidencia experimental

No se encontró una muestra que acredite p95 de galería ni éxito agregado de
inscripción. Se define cómo obtenerla sin inventar valores ni presentar la
demo futura como prueba de carga.

La inspección de `scripts/deployed-issue-87-acceptance.mjs` detectó que
`enrolledAfterMs` no mide S3 PUT → ENROLLED: A incluye el matching posterior;
B incluye una espera previa de cinco segundos y termina antes del sondeo.
Las cifras narrativas previas tampoco coinciden con las del JSON enlazado.
Se corrige la interpretación en memoria, capítulos 3/8 y evidencia #87,
preservando los datos históricos. El objetivo de tres segundos queda no
acreditado, sin atribuirle un incumplimiento que esos intervalos no demuestran.

## Estado remoto y despliegue

Consulta de GitHub mediante CLI, 25 de octubre de 2026:

- [#98](https://github.com/upc-malvaviscos/findly/issues/98) está cerrada por
  [confirmación manual del equipo](https://github.com/upc-malvaviscos/findly/issues/98#issuecomment-6361540360)
  sobre dos proveedores. El recibo del run `38955016584` conserva alcance de
  un destinatario. Se sincronizan los textos que todavía la daban por abierta.
- [#166](https://github.com/upc-malvaviscos/findly/issues/166) y #171–#174
  mantienen pendiente la aceptación AWS específica de carreras/TTL.
- [#175](https://github.com/upc-malvaviscos/findly/issues/175) y
  [#186](https://github.com/upc-malvaviscos/findly/issues/186) están cerradas,
  con sus evidencias de recuperación y publicación documental.
- El equipo confirma en esta tarea que la aplicación está desplegada y
  funcional, con dominio registrado y demo prevista para la defensa.
  Una petición HEAD HTTPS a `https://www.findly.barcelona` devuelve HTTP 200
  y `text/html`; solo verifica entrega del documento público, no una nueva
  aceptación de API, matching, correo ni rendimiento.

No se ejecutan nuevas cargas, despliegues, envíos, cambios de permisos o
lecturas autenticadas de datos biométricos. No se publica información de
participantes, credenciales ni enlaces privados.

## Validación

- `npm run harness:check`: entorno Node.js 24 compatible.
- `npm run verify`: lint, tipos, 901 pruebas, build y contratos Terraform
  superados. La primera pasada se detuvo en el escáner de ficheros porque la
  sustitución arquitectura.py → arquitectura.dot aún no estaba en el índice.
  Tras registrar esa eliminación, `npm run security` pasó (0 vulnerabilidades).
- `npm run lint:markdown`: 145 archivos sin incidencias tras la integración final.
- `npm run sync:check`: 22 requisitos trazados; no acredita AWS real.
- Modelo de costes ejecutado offline; comprobados límites de tramos Group 1,
  indexación de selfies, incremento de backfill y suma de componentes.
- Primer PDF compilado con toolchain fijada y 35 páginas renderizadas/revisadas.
  Se detectaron columnas estrechas y secuencia ilegible; se corrigieron.
  PDF final: 38 páginas A4 compiladas, renderizadas y revisadas; tablas,
  secuencia y costes comprobados también a tamaño ampliado.

## Pendientes de información

- Dedicación individual: se documentan issues asignadas y commits registrados
  en team-activity-2026-10-26.json; no permiten inferir horas de trabajo.
- p95, éxito agregado y latencia precisa de selfie: requieren mediciones
  válidas, con campaña operativa autorizada si no existen exportaciones.
- Coste: el equipo declara 1,41 EUR de Rekognition y 0,30 EUR de S3; faltan
  periodo y factura. El contraste parcial de Calculator muestra una suma
  duplicada en Group 1 y no valida el total del modelo.

Seguimiento: [#192](https://github.com/upc-malvaviscos/findly/issues/192).

## Información incorporada el 26 de octubre

La respuesta del equipo autoriza preparar la campaña AWS para revisión previa,
no ejecutarla. Se crea [#193](https://github.com/upc-malvaviscos/findly/issues/193)
con el [protocolo](aws-performance-campaign-plan.md). El inicio observable del
repositorio es el 26 de junio de 2026, commit 397abdf; el backlog se abre en
septiembre. Se consultaron las asignaciones actuales de issues y la autoría
registrada de commits, sin publicar emails de los integrantes.

El modelo FinOps conserva el gasto declarado de 1,71 EUR (dos partidas), el
[contraste parcial y capturas](finops-2026-10-25/README.md) y su discrepancia.
No se accedió a facturación autenticada ni se desplegaron recursos.

## Previsiones de coste aportadas por el equipo

Se incorporan [capturas, transcripción y límites](finops-2026-10-25/team-cost-forecast.md)
en USD: agosto/septiembre son costes reales comunicados; octubre/noviembre,
previsiones. Noviembre suma 2,986 USD, con un 90,46 % en Rekognition. Se corrige
la lectura de septiembre (persiste un cargo residual de RDS) y se conserva
pendiente la atribución individual de los cargos a Findly. Las cifras no se fusionan con la
declaración anterior en EUR ni con el modelo de escenarios.

Validación de esta ampliación: Markdown sin incidencias (146 ficheros),
trazabilidad de 22 requisitos y PDF recompilado de 38 páginas, renderizado
y revisado. Sumas y porcentajes contrastados independientemente por un subagente.

## Revisión de estilo afirmativo

Se reformulan las contraposiciones retóricas de la memoria y los capítulos
02–09 mediante afirmaciones directas sobre propósito, funcionamiento y alcance.
Las métricas pendientes, las limitaciones de autorización y los ensayos fallidos
conservan su significado y sus fuentes. El equipo confirma además que las
capturas de costes corresponden a toda la cuenta AWS; la atribución individual
al proyecto requiere desglose por recursos o etiquetas.

Validación de estilo: Markdown (146 ficheros), trazabilidad (22 requisitos),
compilación del PDF y revisión visual de sus 38 páginas completadas.

## Convención numérica

Las tablas de costes y la explicación del modelo usan punto para los miles
y coma para los decimales. El README de la memoria documenta esta convención
para las siguientes ediciones; los formatos de intercambio mantienen su sintaxis.
