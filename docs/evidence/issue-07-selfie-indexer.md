# Issue #7: primera entrega del indexador de selfies

> Documento histórico de la rama anterior a su alineación (2026-09-29).
> Sus decisiones y resultados describen aquella versión, no el contrato vigente.
> Se adopta la implementación de main y sus ADR-011 a ADR-015; véase
> [la evidencia de alineación](issue-07-main-alignment.md).

## Alcance

Registro histórico de la primera entrega. La validación posterior de condiciones
DynamoDB y GSI1 en Floci se documenta en
[la segunda entrega](issue-07-floci-integration.md); los límites de recuperación,
borrado y validación AWS siguen pendientes.

Fecha: 2026-09-28. Rama: `feature/issue-7-selfie-enrollment-rekognition`.
Base sincronizada: `3678a14`. La rama aún no existía en origin; se intentó el
pull de la rama y se actualizó desde main mediante `git pull --rebase origin main`.

Se añaden `src/lambdas/selfieIndexer.ts`, el parser de claves de selfies y
pruebas unitarias/contrato con SDK simulado. Se conservan los contratos públicos
de inscripción. No se modifica infraestructura, no se aplica Terraform y no
se ejercitan AWS ni Floci en esta entrega. No hay PR creada.

## Matriz de aceptación

| Criterio                                 | Prueba local                                                                             | Límite                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Rostro aceptado a ENROLLED               | Respuesta SDK sintética, estado, FaceId y GSI1                                           | No prueba reconocimiento ni trigger AWS               |
| Sin rostro/calidad insuficiente a FAILED | FaceRecords vacío y rechazo de calidad simulado                                          | No demuestra clasificación de una imagen borrosa real |
| Pruebas aws-sdk-client-mock              | Suite selfieIndexer                                                                      | Unitarias/contrato según la estrategia del proyecto   |
| Idempotencia                             | Estado final, rechazo de lease concurrente y recuperación de lease vencida               | Condiciones DynamoDB aún no verificadas con Floci     |
| Consentimiento y privacidad              | Registro ausente/caducado/inválido, borrado antes de finalizar, logs sin datos sensibles | Coordinación distribuida completa pendiente           |

## Validación

Se instaló el lockfile con `npm ci`; no se cambiaron dependencias.

| Comando                                                                                  | Resultado                                                                                                                          |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm run harness:check`                                                                  | Inicialmente faltaban dependencias y TFLint en Windows; TFLint sí está instalado en WSL                                            |
| `npm exec -- vitest run tests/lambdas/selfieIndexer.test.ts tests/shared/s3Keys.test.ts` | 62 pruebas pasan                                                                                                                   |
| `npm run test`                                                                           | 244 pruebas pasan en 26 archivos                                                                                                   |
| `npm run typecheck`                                                                      | Pasa                                                                                                                               |
| `npm run build`                                                                          | Pasa; 7 ZIP verificados; indexador compilado con target Node 22, importación comprobada en Node 24                                 |
| `npm run lint` y `npm run verify`                                                        | Se detienen en `lint:terraform`: TFLint no está en PATH de Windows                                                                 |
| ESLint, Prettier y Markdownlint incluidos en lint                                        | Pasan                                                                                                                              |
| TFLint 0.64.0 desde WSL                                                                  | Pasan las cinco raíces, con los mismos argumentos de `scripts/terraform-lint.mjs`                                                  |
| `npm run lint:workflows`                                                                 | Pasa, usando el binario fijado por el paquete local                                                                                |
| `npm run terraform:format`                                                               | Pasa                                                                                                                               |
| `npm run terraform:validate`                                                             | Bootstrap, sandbox, demo y production pasan; ephemeral queda pendiente por timeout TLS descargando el proveedor, tras un reintento |
| `npm audit --omit=dev`                                                                   | 0 vulnerabilidades de producción                                                                                                   |
| `npm run sync:check` y `npm run security:tracked-files`                                  | Pasan; no verifican GitHub remoto ni archivos nuevos sin seguimiento respectivamente                                               |

Cobertura del handler: líneas, sentencias y funciones 100 %; ramas 95,5 %.
La cobertura mide código ejecutado con mocks, no disponibilidad ni garantías AWS.
La compilación web emite avisos de anotaciones de Rollup en Zod, sin fallar.
Los hashes Windows añadidos por `terraform init` se retiraron del diff; no se
modifican los lockfiles de infraestructura en esta entrega.
No se presenta `verify` como superado: falta un entorno único con todas las
herramientas en PATH. No se ejecutó Floci ni E2E, porque el handler aún no está
conectado a un recorrido de usuario. Se mantienen para la siguiente etapa.

## Límites que impiden declarar la issue completada

- Un reintento tras indexación y fallo de escritura depende de la deduplicación
  de Rekognition para la misma imagen, colección e identificador externo. Se
  transmite Version si S3 la proporciona. Antes de desplegar debe acordarse y
  probarse cómo impedir que una sobrescritura de la clave cambie esa imagen.
- Las escrituras condicionales no recrean una inscripción borrada. Si el borrado
  se detecta al finalizar, se intenta eliminar el FaceId creado. No se garantiza
  todavía recuperación de una limpieza fallida, de un timeout entre indexación
  y persistencia o de todas las carreras con el borrador existente. Estos casos
  necesitan coordinación y evidencia antes de activar el trigger.
- La suite simula las respuestas condicionales de DynamoDB; las carreras reales,
  GSI1, los permisos y la entrega S3 a Lambda requieren siguientes etapas.
- No hay endpoints públicos nuevos, cambios al formulario, nuevo bucket,
  provisionamiento ni prueba biométrica real.
- La issue remota todavía no está sincronizada: GitHub CLI no está disponible
  ni en Windows ni en WSL. No debe cerrarse. Este archivo no sustituye el
  checklist de GitHub. El comentario pendiente debe enlazar esta evidencia,
  indicar que no existe PR aún, las 244 pruebas unitarias superadas y los límites
  anteriores; sólo el criterio de pruebas con SDK simulado está demostrado.
