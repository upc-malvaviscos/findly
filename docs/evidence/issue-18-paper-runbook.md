# Evidencia de memoria, ADR y runbook de demostración

Implementación de la spec 17 ([issue #18](https://github.com/upc-malvaviscos/findly/issues/18)):
sincroniza `docs/paper/` con el estado real del sistema tras la aceptación AWS
de la issue #70 (PR #71) y añade el runbook de demostración por niveles.

**No se ha aplicado nada nuevo en AWS ni se ha publicado ninguna SPA.** Esta
entrega es documentación: consolida evidencia ya existente y verifica los
comandos locales que cita.

## Alcance verificado

- `docs/paper/03-requisitos-y-viabilidad.md`: requisitos funcionales/no
  funcionales de spec 00, análisis del patrón de matching de Rekognition
  (spec 07), y la alternativa de persistencia citando el análisis de la
  issue #49 como decisión abierta, sin presentarla como aprobada.
- `docs/paper/08-validacion-y-resultados.md`: consolida evidencia con enlaces
  — resultados locales de esta entrega (typecheck, lint, build, 294 tests/38
  archivos, 290 pasan), cobertura por ámbito, E2E, Terraform, y el run de
  aceptación AWS real de PR #71 con lo que demuestra y lo que declara
  explícitamente pendiente.
- `docs/paper/09-conclusiones-y-trabajo-futuro.md`: objetivos logrados y ocho
  limitaciones verificadas, cada una trazada a su issue o evidencia.
- `docs/paper/10-referencias.md`: 15 referencias numeradas con URL y fecha de
  consulta, sustituyendo el placeholder de dos referencias sin consultar.
- `docs/paper/11-anexos.md`: variables no sensibles por entorno, comandos de
  despliegue, nombres de outputs de Terraform (sin valores), matriz de coste
  por tipo de recurso y enlaces a la evidencia adicional.
- `docs/runbooks/demo-runbook.md` (nuevo): tres niveles explícitos — local con
  Floci (ejecutable hoy, sin AWS), AWS efímero de pull request (real, pero
  sólo reproducible desde una PR de este repositorio) y `demo` persistente
  (bloqueado por #15/#61). No presenta el nivel 1 como equivalente a una
  demostración AWS.
- `docs/README.md`: referencia añadida a `runbooks/` y al runbook de demo.
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

## Pendiente

- El cierre completo de #18 exige una SPA `demo` publicada y navegable, que
  depende íntegramente de #15 (despliegue manual OIDC) y #61 (bootstrap del
  estado Terraform). Ninguna de las dos está resuelta.
- La cifra de cobertura global (81,34 % de líneas) se cita explícitamente como
  no sujeta a ningún umbral del 90 %; sólo `src/lambdas` y `src/shared/lib` lo
  están y ambos lo superan.
- No se abre ADR nuevo: esta entrega es documentación de trazabilidad, no una
  decisión arquitectónica.
