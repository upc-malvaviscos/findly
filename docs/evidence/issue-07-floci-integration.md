# Issue #7: integración local del indexador con Floci

> Documento histórico de la rama anterior a su alineación (2026-09-29).
> Sus decisiones y resultados describen aquella versión, no el contrato vigente.
> Se adopta la implementación de main y sus ADR-011 a ADR-015; véase
> [la evidencia de alineación](issue-07-main-alignment.md).

## Alcance y reproducción

Fecha: 2026-09-28. Base: `8cdc931`, rama
`feature/issue-7-selfie-enrollment-rekognition`. El pull de la rama no encontró
referencia remota; `git pull --rebase origin main` confirmó que estaba actualizada.

Con Node.js 24, dependencias del lockfile y Docker Compose disponibles:

```sh
npm run test:floci:integration
```

El runner crea un proyecto Compose aleatorio y publica Floci únicamente en un
puerto libre de `127.0.0.1`. Usa credenciales sintéticas, una tabla con GSI1 y un
bucket propios. Elimina su contenedor y red en `finally`, incluso ante fallo.
No usa el proyecto Compose de desarrollo ni sus volúmenes. No se despliega AWS.

Imagen utilizada: `floci/floci:latest`, identificador observado:
`sha256:f5aa8c18302cedb4f2385f5c4e455b3efc77fee6bf7b6e5d1712b2817ba102db`.
El tag sigue siendo mutable; el runner imprime el identificador en cada ejecución.

## Matriz de evidencia

Las diez pruebas de `tests/integration/selfieIndexer.test.ts` invocan el handler
con un evento construido. Los SDK de DynamoDB y S3 hacen peticiones HTTP a
Floci; únicamente el SDK de Rekognition usa `aws-sdk-client-mock`.

| Caso                                 | Comprobación                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Éxito                                | Objeto sintético legible desde S3; ENROLLED, FaceId y GSI1 consultables; bloqueo eliminado                       |
| Evento duplicado                     | No vuelve a llamar a IndexFaces ni a crear colección                                                             |
| Sin cara utilizable                  | FAILED persistido y sin reintento del resultado terminal                                                         |
| Concurrencia                         | Una escritura condicional reclama PROCESSING; la segunda invocación rechaza y su reentrega termina sin reindexar |
| Fallo transitorio                    | Reintenta tras vencer el bloqueo, sin ampliar TTL; se adelanta la caducidad del bloqueo en la fixture            |
| Borrado durante indexación           | La actualización condicional no recrea la inscripción y solicita DeleteFaces al mock                             |
| Consentimiento ausente o TTL vencido | Dos casos sin mutación ni llamada a Rekognition                                                                  |
| Registro ausente                     | Un objeto no crea una inscripción por sí mismo                                                                   |
| Colección existente                  | Acepta ResourceAlreadyExistsException simulado y persiste ENROLLED                                               |

El objeto contiene texto sintético, no una imagen facial. La lectura S3 dentro
del mock comprueba la referencia al objeto; no demuestra acceso de Rekognition
a S3, detección de caras, calidad ni deduplicación del servicio real.
Tampoco se prueban IAM, notificaciones S3 a Lambda, runtime Lambda ni TTL
automático de DynamoDB. El borrado compensatorio sigue siendo una petición
simulada, no una garantía de recuperación distribuida completa.

## Validación

- `npm run test:floci:integration`: 10 pruebas pasan. Contenedor y red eliminados.
- La primera ejecución detectó un uso incorrecto de `expect.poll` en el setup;
  se corrigió con `waitUntilTableExists`. Esa ejecución fallida también limpió
  sus recursos. No se alteró el handler para superar las pruebas.
- `npm run test`: 244 pruebas unitarias pasan en 26 archivos.
- `npm run typecheck` y `npm run lint:code`: pasan.
- `npm run build`: pasa; siete ZIP Lambda verificados. Avisos de anotaciones
  Rollup en Zod sin fallo de compilación.
- `npm run lint:workflows` y `npm run sync:check`: pasan.
- `npm run verify`: se detiene en `lint:terraform` porque TFLint no está
  disponible en el PATH de Windows. ESLint, Prettier y Markdownlint previos
  pasan; no se declara superada la verificación completa.
- Los contenedores manuales `findly-floci-1` y `findly-local-api-1` siguen
  activos y no quedan contenedores `findly-selfie-tests` después de la prueba.

La CI local ejecutará `test:floci:integration` antes de su Playwright existente
a través de `test:floci`. No se ha ejecutado aquí ese comando agregado ni
Playwright: no cambió el flujo de usuario y se conserva la sesión manual
Compose en marcha. No se afirma haber ejecutado el workflow remoto.

## Trazabilidad y pendientes

Se actualizan la spec 06, la estrategia de pruebas, los modos de ejecución y
la memoria de implementación. Se conserva ADR-010 sin decisiones nuevas.
Esta evidencia amplía [la primera entrega](issue-07-selfie-indexer.md).

Siguen pendientes la infraestructura del bucket separado y Lambda, la entrega
automática S3, el smoke AWS, la identidad estable de la imagen entre reintentos
y las carreras de borrado/limpieza descritas en la primera entrega. No se
habilita el formulario ni se cierra la issue.

No hay PR de esta entrega. La sincronización remota de la issue #7 continúa
pendiente: GitHub CLI no está disponible en este entorno. El comentario remoto
debe enlazar esta evidencia, indicar las 10 pruebas Floci y 244 unitarias,
aclarar el mock de Rekognition y mantener abiertos los pendientes anteriores.
