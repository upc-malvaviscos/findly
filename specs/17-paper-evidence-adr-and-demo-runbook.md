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
escritos con evidencia enlazada, sin AWS aplicado ni SPA publicada. El
consentimiento, matching, galería y DELETE ya están verificados en AWS real
por la aceptación de #70/PR #71 (capítulo 8); lo que sigue pendiente para el
cierre completo de esta issue es exclusivamente lo que dependen #15/#61: el
bootstrap del estado Terraform y el despliegue manual, y por tanto una SPA
`demo` publicada y navegable. Evidencia:
[`docs/evidence/issue-18-paper-runbook.md`](../docs/evidence/issue-18-paper-runbook.md).
No se cierra esta issue con esta entrega.
