# Issue #7: alineación con la implementación integrada en main

## Alcance autorizado

Fecha: 2026-09-29. Base adoptada: `origin/main@e7da348`.
La persona responsable pide conservar el código y las decisiones de Anyul.
Se incorporan sus handlers, contratos, UI, pruebas y Terraform sin cambios
funcionales propios. No se realiza push, despliegue, merge a main ni operación AWS.

Se retira el módulo duplicado `selfie-enrollment`, el segundo bucket y su
compilación Node 22. Rigen Node 24, bucket compartido, sufijos `.selfie.jpg`
y `.photo.jpg`, namespace por entorno y locator RETENTION sin TTL de main.
Los ADR-011 a ADR-015 de main prevalecen sobre las propuestas anteriores de
esta rama, conservadas explícitamente como documentos históricos.

Los cinco lockfiles locales del proveedor 5 se preservan en el stash
`preserve-local-provider-checksums-before-main-alignment`. No se aplican sobre
los lockfiles del proveedor 6 de main. La integración se prepara en la rama
feature; no se crea el commit de integración ni se modifica la rama main.

## Aportación de esta rama

`npm run test:floci:integration` conserva un contenedor aislado y adapta sus
fixtures al contrato vigente: locator ACTIVE con collectionId, bloqueo en
milisegundos y carga condicional explícita `writeOnce`.

Se añaden recorridos de inscripción pública con transacción DynamoDB real
emulada, PUT prefirmado a S3 emulado, invocación explícita del indexador y
polling autorizado. Se comprueban ENROLLED y FAILED, rechazo de otro token,
persistencia del candidato en el locator, concurrencia, reintento y limpieza
fallida seguida de nueva entrega. Sólo Rekognition está simulado.

La suite se añade al job E2E local de CI; no modifica sus despliegues.
Las pruebas existentes de main permanecen intactas. No se añade un segundo
handler ni se alteran los permisos, retención o arquitectura de producción.

## Criterios y límites

| Criterio de #7                                | Evidencia local                                            |
| --------------------------------------------- | ---------------------------------------------------------- |
| IndexFaces con un rostro y QualityFilter AUTO | Pruebas unitarias de main y persistencia Floci             |
| UPLOAD_PENDING a PROCESSING a ENROLLED        | Integración de inscripción, indexador y polling            |
| Sin rostro a FAILED sin excepción             | Integración con resultado Rekognition simulado             |
| Reentrega sin nueva indexación                | Integración con estado DynamoDB persistido                 |
| Recuperación y borrado concurrente            | Locator persistido y repetición tras fallo de limpieza     |
| Sin imágenes en DynamoDB                      | Fixtures de metadatos; el objeto sintético se guarda en S3 |

No se acredita reconocimiento de una imagen borrosa real, notificación
automática S3 a Lambda, IAM ni reintentos administrados de AWS. El último
timeout documentado en `issue-70-integration.md` no tiene causa demostrada;
no se cambia el algoritmo ni se amplía el polling para ocultarlo.
Su diagnóstico y la aceptación AWS siguen pendientes bajo la prohibición
expresa de desplegar. La issue no se cierra ni se presenta lista para merge
por el mero resultado de mocks o Floci.

## Validación

Entorno WSL, Node 24.21.0, npm 11.19.0, Terraform 1.16.4 y TFLint 0.64.0.
Dependencias instaladas desde el lockfile de main. Docker Desktop se inició
para estas pruebas; no se consumió ninguna cuenta AWS.

- `npm run harness:check` y `npm run harness:check:e2e`: pasan.
- `npm run typecheck`: pasa.
- `npm run test`: 294 pruebas en 38 archivos; gates de cobertura aprobados.
- `npm run test:floci:integration`: 14 pruebas pasan. Imagen Floci
  `sha256:f5aa8c18302cedb4f2385f5c4e455b3efc77fee6bf7b6e5d1712b2817ba102db`.
- `npm run test:e2e`: 12 pruebas pasan en Chromium, Firefox y WebKit con HTTP
  simulado.
- `npm run test:e2e:local`: 21 pruebas pasan en los tres navegadores. Proyecto
  Compose aislado `findly-issue7-alignment-20260929`, puertos 4666/8887/4273.
  Se eliminaron únicamente sus contenedores, volúmenes y red al terminar.
- `npm run verify`: pasa completo con código 0. Incluye ESLint, Prettier,
  Markdownlint, TFLint, actionlint, tipos, pruebas, nueve paquetes Lambda,
  formato y validación de cinco raíces Terraform, security y sync:check.
  Auditoría de producción: cero vulnerabilidades. Terraform conserva los
  avisos de deprecación del esquema DynamoDB de main; no hay errores.

Reproducción de los E2E Floci sin compartir el proyecto Compose manual:

```sh
COMPOSE_PROJECT_NAME=findly-issue7-alignment \
  FLOCI_PORT=4666 LOCAL_API_PORT=8887 WEB_PORT=4273 npm run test:e2e:local
```

Terraform añade el checksum Linux del proveedor firmado 6.66.0 a los lockfiles;
no cambia su versión ni retira los hashes existentes de main.

## Sincronización remota

No se ha publicado un comentario en GitHub ni cerrado la issue. Antes del
merge debe adjuntarse esta evidencia y resolver los criterios pendientes.
