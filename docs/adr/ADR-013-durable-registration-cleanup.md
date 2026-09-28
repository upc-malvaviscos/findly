# ADR-013: Localizador durable para borrado y reconciliación

## Estado

ACEPTADO (2026-09-28), decisiones de implementación de issue 70.

## Decisión

Cada inscripción nueva crea transaccionalmente un localizador
`EVENT#eventId / RETENTION#registrationId` sin TTL, junto con REG y TOKEN.
Conserva el hash del token, la clave de selfie, colección de origen y FaceIds
conocidos para limpiar aunque DynamoDB TTL elimine REG primero. No contiene
email ni token secreto; los identificadores y FaceIds siguen siendo datos
sensibles y no se registran en logs.

Borrado marca REG y localizador antes de limpiar. Lista las caras de la
colección por páginas y selecciona únicamente `ExternalImageId` igual al
registrationId; excluye caras temporales de fotografías y otras personas.
Esto reconcilia el crash entre IndexFaces y persistir FaceId. Los FaceIds
conocidos y descubiertos quedan guardados antes de intentar su eliminación.
Si falla una dependencia, se conserva la referencia durable para reintentar.

Después del borrado, el localizador conserva un marcador hasta la purga del
evento. Se retiran hash y FaceIds cuando la limpieza termina; el cron sigue
reconciliando marcadores de eventos activos para capturar escrituras tardías.
Una URL PUT emitida antes del borrado no queda revocada por DELETE. Las
selfies nuevas usan escritura única y el consumidor limpia subidas tardías
cuando la inscripción está ausente o borrándose.

La purga consulta GSI2 y particiones primarias, sin Scan. Elimina coincidencias,
tokens y objetos; conserva los metadatos y localizadores durante una barrera
mínima que cubre URL PUT de 300 segundos, edad máxima asíncrona configurada de
seis horas y timeout del trabajador. Para el evento se usan 30 segundos, el
máximo de PhotoMatcher; el localizador conserva los 10 de SelfieIndexer.
La colección se elimina al final y los metadatos después de confirmar éxito.

## Compatibilidad y límites

Las colecciones AWS nuevas se aíslan por entorno. Un FaceId legacy sin
localizador que identifique la colección de origen exige migración explícita;
no se elimina REG ni se finge haber borrado una cara de una colección global.
Los datos antiguos sin localizador no adquieren uno automáticamente ni se
recuperan mediante Scan. Su reconciliación/migración sigue siendo pendiente.

La barrera no demuestra un límite universal de entrega de notificaciones S3.
La reconciliación durante el evento y el consumidor de objetos huérfanos son
necesarios. DELETE 204 certifica la limpieza observada en esa ejecución, no
que todos los productores distribuidos hayan terminado instantáneamente.
El cron real, fallos AWS y compensaciones distribuidas requieren evidencia
separada de los mocks SDK.

El modo Floci puede omitir descubrimiento biométrico sólo con la bandera
explícita `FINDLY_LOCAL_NO_BIOMETRICS=1`, endpoint local autorizado, ausencia
de FaceIds conocidos y fuera de AWS Lambda. No ofrece ese fallback en AWS.
