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
  - *Solución*: Cada métrica o resultado debe enlazar a su captura o log de comprobación.

## Lista de Verificación Pre-PR (Junior Checklist)
- [ ] La memoria del proyecto refleja la pila tecnológica actual (React + Vite + AWS Serverless).
- [ ] El runbook de demo puede ser ejecutado por una persona ajena al equipo.
