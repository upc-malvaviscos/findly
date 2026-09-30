# ADR-010: Colecciones por evento y bucket separado de selfies

> Documento histórico de la rama anterior a su alineación (2026-09-29).
> Sus decisiones y resultados describen aquella versión, no el contrato vigente.
> Se adopta la implementación de main y sus ADR-011 a ADR-015; véase
> [la evidencia de alineación](../evidence/issue-07-main-alignment.md).

## Estado

Decisiones aceptadas por la persona responsable en la tarea de la issue #7
(2026-09-28). Implementación incremental; infraestructura de inscripción
declarada en Terraform y validada localmente, sin despliegue AWS.

## Contexto

La issue #7 requiere inscripción asíncrona S3 a SelfieIndexer a Rekognition.
El código existente usa `findly-event-{eventId}` para matching y borrado, pero
no crea colecciones. Fotos y selfies comparten el bucket de subidas y la regla
S3 del matcher (`events/` y `.jpg`) abarca ambas. No se puede añadir una segunda
notificación con filtros solapados para el mismo tipo de evento.

## Decisiones

- Mantener una colección por evento. SelfieIndexer asegura su existencia al
  procesar una selfie de una inscripción consentida, antes de indexar. Acepta
  una creación concurrente que responda que ya existe; otros errores se propagan.
- Conservar el bucket actual para fotografías y añadir un bucket privado para
  selfies, manteniendo `events/{eventId}/selfies/{registrationId}.jpg`. No se
  modifica el circuito S3 a SQS a PhotoMatcher.
- Runtime de la nueva Lambda: Node.js 22, 512 MB, 10 segundos. El desarrollo
  local sigue usando Node.js 24. El artefacto del indexador se compila para 22.
- Una inscripción conserva una selfie mientras exista su objeto: el prefirmado
  y el cliente público usan `If-None-Match: *`. La política S3 exige esa condición
  en `events/*/selfies/*.jpg`; CORS permite el encabezado. Las fotos conservan
  su contrato. Otra inscripción tiene otra clave; no se impone unicidad por
  persona/evento ni se implementa un endpoint de sustitución.
- El borrado marca `erasureRequested` mediante UpdateItem condicional antes
  de efectos externos, y retira GSI1. El indexador exige que no exista esa marca
  al reclamar y al finalizar. Un bloqueo activo devuelve `409
INVALID_REGISTRATION_STATE`; el cliente debe repetir el DELETE. La marca
  no se revierte. No se amplía TTL ni se añade un nuevo estado público.
- Si queda `PROCESSING` tras vencer el bloqueo, el borrador pagina `ListFaces`
  y filtra por `ExternalImageId = registrationId` para recuperar FaceIds que
  pudieron no persistirse. Elimina los rostros antes de S3 y DynamoDB. Un fallo
  de limpieza conserva las referencias para repetir la operación, sujeto al
  TTL existente. El permiso `rekognition:ListFaces` debe limitarse a las
  colecciones del proyecto al conectar la Lambda de borrado.
- El formulario y los endpoints públicos pendientes no se incorporan a esta
  primera entrega. La dependencia atribuida a #7 por spec 18 requiere acordar
  su alcance con el equipo; no se da por satisfecha por implementar el handler.

## Consecuencias y trabajo pendiente

La administración no depende de Rekognition para crear un evento. Si se suben
fotografías antes de existir la colección, el matcher actual falla y reintenta;
no se incorpora reprocesamiento de fotos al inscribirse asistentes después.

La separación requiere conectar prefirmado, IAM, borrado individual y purga a
los buckets correctos. `selfie-enrollment` declara bucket separado, Lambda,
IAM y notificación; `findly-stack` lo incorpora en sandbox, demo y production.
Las salidas publican el bucket para los consumidores futuros. La API pública
y el cableado de borrado/purga a ambos buckets siguen pendientes; no hay
migración de objetos ni apply en esta entrega. La protección de identidad y
coordinación local se verifican
en [la tercera entrega](../evidence/issue-07-conditional-upload-erasure.md).
La persona responsable aplaza la recuperación automática, la excepción de TTL
y los cambios de PhotoMatcher propuestos en ADR-011 para acotar la issue #7.
Los riesgos de borrados abandonados, caducidad de referencias y carreras con
purga/matching permanecen abiertos; no se declaran resueltos por Terraform.
No se autoriza ningún despliegue AWS. La lease presupone el timeout Lambda de 10 s;
no demuestra que una operación remota termine al abortarse el proceso.
Una URL aún vigente podría recrear un objeto después del borrado: la condición
evita sobrescribir, no revoca URLs. Esa limpieza tardía sigue pendiente.

Floci no implementa las operaciones de colecciones de Rekognition necesarias.
Los mocks verifican contratos y ramas de código, no reconocimiento facial.

## Referencias

- [Spec 06](../../specs/06-selfie-enrollment-and-rekognition-indexing.md).
- [Evidencia de la primera entrega](../evidence/issue-07-selfie-indexer.md).
- [Filtros S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-filtering.html).
- [IndexFaces e idempotencia de imagen, colección y ExternalImageId](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_IndexFaces.html).
- [Escrituras condicionales S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).
- [Políticas para exigir escrituras condicionales](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html).
- [ListFaces y paginación](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_ListFaces.html).
