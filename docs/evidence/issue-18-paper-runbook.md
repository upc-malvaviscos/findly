# Evidencia de memoria, ADR y runbook de demostración

Implementación de la spec 17 ([issue #18](https://github.com/upc-malvaviscos/findly/issues/18)):
sincroniza `docs/paper/` con el estado real del sistema tras la aceptación AWS
de la issue #70 (PR #71), amplía la memoria a profundidad de TFM (a petición
explícita de la persona responsable, que además fijó un objetivo orientativo
de 25-30 páginas, no un límite estricto), y añade el runbook de demostración
por niveles junto con una guía exhaustiva de despliegue en AWS real.

**No se ha aplicado nada nuevo en AWS ni se ha publicado ninguna SPA.** Esta
entrega es documentación: consolida evidencia ya existente y verifica los
comandos locales que cita.

## Alcance verificado

Memoria (`docs/paper/`), de ~5.400 a ~12.650 palabras (~28 páginas a la
densidad estimada de este proyecto):

- `01a-acronimos.md` (nuevo): glosario de todos los acrónimos realmente usados
  en `docs/paper`, `specs` y `docs/adr`, agrupados por ámbito — exigido por el
  formato "Connected Vehicle" de `docs/README.md`, no existía.
- `02-contexto-objetivos-y-alcance.md`: renombrado para incluir metodología;
  añade el ciclo research/plan/implement/sync de `AGENTS.md`, las 3 fases
  reales del proyecto con diagrama de línea de tiempo Mermaid, una tabla de
  trazabilidad de las 29 issues del repositorio (número, spec, fechas,
  estado, fase) y un análisis de la auditoría #70 como puerta de calidad,
  verificado contra fechas reales de GitHub (`#6`/`#8` reabiertas y
  recerradas el mismo día, 2026-09-28).
- `04-arquitectura-y-decisiones.md`: reestructurado en HLD/LLD; añade un
  catálogo de 14 servicios AWS + herramientas de terceros con el mecanismo
  exacto de comunicación de cada uno, y 5 diagramas de secuencia (inscripción,
  matching, galería/borrado, purga, despliegue OIDC). Corrección encontrada y
  aplicada: el capítulo citaba un `Scan` de `retentionPurger` que la fase 3
  del proyecto ya sustituyó por `Query` sobre `GSI2` — verificado contra
  `src/lambdas/retentionPurger.ts` en `main`, no repetido de memoria.
- `05-implementacion-y-cicd.md`: de 166 a 1.401 palabras; el empaquetado de
  Lambdas, las 5 raíces Terraform, y los 6 workflows de GitHub Actions
  explicados uno a uno.
- `06-seguridad-privacidad-y-gobierno.md`: de 123 a 1.367 palabras; consentimiento,
  autenticación, tokens opacos, tabla IAM Lambda por Lambda, OIDC, borrado de
  biometría y 3 limitaciones de privacidad explícitas. Hallazgo verificado:
  `infra/modules/github-oidc/` no lo instancia ningún root — los roles reales
  se gestionan a mano fuera de Terraform.
- `03-requisitos-y-viabilidad.md`, `08-validacion-y-resultados.md`,
  `09-conclusiones-y-trabajo-futuro.md`, `10-referencias.md`,
  `11-anexos.md`: reforzados (matriz de trazabilidad spec↔issue↔evidencia de
  16 filas en el 08, verificada contra los ficheros reales de
  `docs/evidence/`; principios FinOps y sección de sostenibilidad honesta en
  el 07; lección de metodología cuantificada en el 09; referencias de 15 a
  24 entradas en el 10).

Runbooks y README:

- `docs/runbooks/aws-deployment-guide.md` (nuevo): guía comando a comando para
  desplegar `sandbox` en AWS real y ejecutar una demo funcional completa,
  verificada contra el código actual de `scripts/aws-sandbox.mjs` e
  `infra/bootstrap/`, no descrita de memoria. Indica explícitamente que la
  restricción de la cuenta compartida del equipo (issue #61) es de esa cuenta,
  no del código, para que una cuenta AWS sin esa restricción pueda seguirla de
  principio a fin.
- `docs/runbooks/demo-runbook.md`: reestructurado de 3 a 4 niveles para
  encajar el nuevo nivel de `sandbox` real por cuenta propia, distinto del
  entorno efímero de PR (sólo CI) y del `demo` publicado (bloqueado, exige
  dominio propio).
- `README.md`: nueva sección "Cómo ver la aplicación funcionando" con los tres
  modos de ejecución comparados y enlazados desde el principio del documento.
- `docs/README.md`: referencia añadida a `runbooks/` y a ambos runbooks.
- `specs/17-paper-evidence-adr-and-demo-runbook.md`: checklist marcado con la
  evidencia y el límite exacto de cada casilla; issue no cerrada.

## Hallazgo durante la implementación: prueba fallida específica de Windows

Al ejecutar `npm run test` para citar cifras exactas en el capítulo 8, 4 de
294 pruebas fallan en esta máquina Windows, las 4 en
`tests/infra/deployedObservability.test.ts`. Diagnóstico verificado por
reproducción aislada (no una suposición): el fixture de esa prueba escribe un
ejecutable `aws` sin extensión con cabecera `#!`, patrón POSIX que la
resolución de procesos de Windows no reconoce como candidato en `PATH`
(exige `PATHEXT`: `.exe`, `.cmd`, `.bat`…), así que el proceso hijo invoca el
`aws` real instalado en el sistema y falla por falta de región configurada, en
vez del comportamiento controlado que la prueba espera. Se descartó como causa
el separador de `PATH` (`:` frente a `path.delimiter`): una reproducción con
el separador correcto falla igual. No se ha corregido: exige una variante de
fixture por plataforma o hacer `scripts/deployed-observability.mjs` consciente
de shell, un cambio a un script que también corre contra AWS real en
`provision-test-destroy` y queda fuera del alcance de una entrega de
documentación. La CI real (Ubuntu) no se ve afectada.

## Validación

```text
npm run typecheck    PASS
npm run lint:code     PASS
npm run build          PASS (web + 9 artefactos Lambda .js y .zip)
npm run test            294 tests, 38 archivos; 290 pasan, 4 fallan
                        (Windows-only, ver hallazgo anterior; 0 fallos
                        atribuibles a esta entrega o a main)
npm run lint:markdown   PASS
npm run sync:check      PASS
```

No se ejecuta `npm run terraform:validate`, `npm run lint:terraform` ni
`npm run test:e2e`: esta entrega no modifica Terraform, workflows ni ningún
flujo de usuario.

## Actualización posterior: cierre de la issue #7 (PR #72 y PR #81)

Tras la entrega inicial, la PR #72 (`feature/issue-7-selfie-enrollment-rekognition`)
se fusionó en `main` con los nueve checks en verde, incluido un
`provision-test-destroy` real en AWS (23m29s). Se revisó su diff frente a la
memoria ya escrita y se corrigieron cinco puntos que habían quedado
desalineados, sin reabrir ninguna otra sección:

- `02-contexto-objetivos-y-alcance.md`: la fila de la issue `#7` y un párrafo
  nuevo narran su cierre completo — PR #72 (evidencia inicial), PR #81
  (sincronización de `specs/06`, bloqueada primero por un permiso Rekognition
  que faltaba) y la sustitución del patrón de permisos por-número-de-PR por
  la política permanente `findly-ephemeral-pr-extensions`
  (`docs/evidence/permanent-ephemeral-ci-iam.md`) que la desbloqueó. `#7` se
  cerró el 02-oct con los tres criterios de la spec 06 acreditados en AWS
  real (verificado contra el comentario de cierre de `anyulled`, no de
  memoria).
- `04-arquitectura-y-decisiones.md`: la PR introdujo en `main` un segundo
  `ADR-010` y un segundo `ADR-011` (`ADR-010-selfie-enrollment-boundaries.md`,
  `ADR-011-pending-erasure-recovery.md`), ambos marcados como documentos
  históricos de una rama previa a su alineación. Se añadió una nota de
  numeración y se aclararon las cuatro citas existentes a `ADR-011` para que
  apunten sin ambigüedad al fichero vigente (`ADR-011-public-enrollment-capability.md`).
  La colisión de numeración en sí queda sin resolver — no es un cambio de
  contenido de esta memoria, sino una decisión pendiente de la persona
  responsable sobre `docs/adr/`.
- `04-arquitectura-y-decisiones.md`: el diagrama de secuencia de matching se
  amplió con el reintento real que `photoMatcher.ts` aplica a `SearchFaces`
  cuando Rekognition devuelve `FaceId was not found` justo después de
  `IndexFaces` (hasta 4 intentos, 200-2000 ms) — verificado contra el código
  actual, no descrito de memoria.
- `05-implementacion-y-cicd.md`: la descripción del job `e2e` de `ci.yml` ya
  incluye el nuevo paso `npm run test:floci:integration`.
- `08-validacion-y-resultados.md`: la sección de pruebas E2E documenta el
  nuevo nivel de 14 pruebas de integración aisladas de `selfieIndexer` contra
  Floci, distinto de los dos tramos Playwright ya descritos.

Los seis diagramas Mermaid de `04-arquitectura-y-decisiones.md`, incluido el
modificado, se revalidaron renderizándolos con `@mermaid-js/mermaid-cli`.
`npm run lint:markdown` pasa sobre los cuatro ficheros tocados. El cierre de
`#7` y la política IAM permanente son obra de `anyulled` y del equipo, no de
esta entrega: aquí sólo se documenta ese resultado ya ocurrido. No se ha
aplicado ningún cambio a `docs/adr/` ni a la numeración de ADRs, que sigue sin
resolver.

## Pendiente

- El cierre completo de #18 exige una SPA `demo` publicada y navegable, que
  depende de #15 (despliegue manual OIDC), todavía sin resolver. El bootstrap
  del estado Terraform (#61) ya se verificó en una cuenta AWS dedicada
  (`docs/evidence/issue-11-terraform-remote-state.md`, PR #83), pero esa prueba
  no dejó ningún entorno desplegado.
- La cifra de cobertura global (81,34 % de líneas) se cita explícitamente como
  no sujeta a ningún umbral del 90 %; sólo `src/lambdas` y `src/shared/lib` lo
  están y ambos lo superan.
- No se abre ADR nuevo: esta entrega es documentación de trazabilidad, no una
  decisión arquitectónica.
