# 17 - Memoria técnica, evidencias, ADRs y Runbook de demostración

## Objetivo
Estructurar la documentación técnica y académica del proyecto en la carpeta `docs/paper/`, manteniendo la trazabilidad con los registros de arquitectura (ADRs), catálogo de evidencias y un runbook ejecutable paso a paso para la demostración del sistema.

## Estructura de Documentación y Memoria (`docs/paper/`)
- `00-portada-y-equipo.md`: Portada, autores y resumen del equipo.
- `01-resumen-ejecutivo.md`: Contexto de negocio y valor de la solución Serverless.
- `02-contexto-objetivos-y-alcance.md`: Objetivos cuantitativos y matriz de alcance.
- `03-requisitos-y-viabilidad.md`: Análisis de viabilidad técnica, económica y legal (GDPR).
- `04-arquitectura-y-decisiones.md`: Diagramas C4, flujo de datos y referencias a ADRs.
- `05-implementacion-y-cicd.md`: Estructura del repositorio, pipelines CI/CD y despliegues OIDC.
- `06-seguridad-privacidad-y-gobierno.md`: IAM mínimo privilegio, cifrado y cumplimiento GDPR.
- `07-finops-observabilidad-y-sostenibilidad.md`: Estimación de costes, Budgets y CloudWatch.
- `08-validacion-y-resultados.md`: Resultados de pruebas Vitest, Playwright y benchmarks.
- `09-conclusiones-y-trabajo-futuro.md`: Lecciones aprendidas y evolución futura.
- `10-referencias.md`: Bibliografía técnica y enlaces AWS.
- `11-anexos.md`: Evidencias suplementarias y capturas de ejecuciones.

## Runbook de Demostración (Step-by-Step Runbook)
1. **Despliegue**: Invocación manual del workflow OIDC para aprovisionar el entorno `demo`.
2. **Inscripción Pública**: Simulación de asistente registrándose y subiendo selfie desde el frontend estático.
3. **Carga Administrativa**: Login en `/admin/login` y subida masiva de imágenes de prueba del evento.
4. **Matching y Consulta**: Redirección a la galería mediante `/gallery?token=...` comprobando coincidencia.
5. **Derecho al Olvido**: Ejercicio de borrado desde el cliente verificando purga en S3, DynamoDB y Rekognition.
6. **Teardown FinOps**: Ejecución del teardown para dejar el entorno a coste cero.

## Criterios de Aceptación
- Cualquier evaluador externo puede ejecutar el Runbook de demostración sin ambigüedades.
- Toda afirmación hecha en la memoria técnica está respaldada por una evidencia verificable en `docs/evidence/` o en los scripts del repositorio.
