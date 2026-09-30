# Issue #7: selfie estable y coordinación de borrado

> Documento histórico de la rama anterior a su alineación (2026-09-29).
> Sus decisiones y resultados describen aquella versión, no el contrato vigente.
> Se adopta la implementación de main y sus ADR-011 a ADR-015; véase
> [la evidencia de alineación](issue-07-main-alignment.md).

## Alcance

Fecha: 2026-09-28. Base: `7dc4e43`. Rama:
`feature/issue-7-selfie-enrollment-rekognition`. Árbol limpio al comenzar.
La rama no existe en origin; `git pull --rebase origin main` confirmó que
estaba actualizada. No se hace commit, PR ni despliegue AWS en esta entrega.

Decisiones aprobadas por la persona responsable y registradas en ADR-010:
evitar sobrescrituras de una selfie existente y ampliar la coordinación de
borrado con SelfieIndexer. No se limita el número de inscripciones por persona.

## Cambios y pruebas

| Contrato                       | Evidencia                                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Selfies con `If-None-Match: *` | Helper de prefirmado, adaptador público y XHR; unitarias verifican selfie condicional y foto sin condición                               |
| PUT inicial y sobrescritura    | SDK prefirmador real + HTTP a Floci: 200, después 412 y contenido original intacto; otra inscripción devuelve 200                        |
| Firma de la condición          | La URL generada incluye `if-none-match` en `X-Amz-SignedHeaders`                                                                         |
| Política del bucket            | Terraform exige el valor `*` en `events/*/selfies/*.jpg` y permite el encabezado en CORS; validate/TFLint, sin prueba de enforcement AWS |
| Borrado concurrente            | Floci ejecuta UpdateItem condicional y marca `erasureRequested`; DELETE devuelve 409 con lease activa; el indexador no completa ENROLLED |
| FaceId no persistido           | ListFaces simulado filtra por ExternalImageId tras vencer lease; unitarias verifican paginación y exclusión de otros asistentes          |
| Limpieza fallida               | Mantiene inscripción y token; otro DELETE recupera el rostro y elimina selfie y referencias; respuestas parciales se validan             |
| Idempotencia de borrado        | Rostro/colección ausentes se toleran; parámetros inválidos y fallos técnicos no se ocultan como éxito                                    |
| Navegador                      | E2E HTTP simulado comprueba que el PUT de inscripción envía la cabecera, en los tres navegadores                                         |

La marca es interna y no añade estados al DTO. Se retiran GSI1PK/GSI1SK para
evitar nuevas búsquedas por rostro una vez propagado el índice. El borrador
obtiene el FaceId y la lease de `UpdateItem ReturnValues=ALL_NEW`, sin la carrera
de leer el rostro antes de impedir que el indexador lo cambie. No amplía TTL.

## Validación reproducible

- `npm run test:floci:integration`: 12 pruebas pasan. DynamoDB/S3 emulados,
  Rekognition simulado y evento S3 construido por el test. El contenedor y red
  temporales se eliminan; la sesión manual no se usa.
- Imagen Floci observada:
  `sha256:f5aa8c18302cedb4f2385f5c4e455b3efc77fee6bf7b6e5d1712b2817ba102db`.
- `npm run test`: 253 pruebas pasan en 26 archivos.
- `npm run typecheck`, ESLint y Prettier: pasan.
- `npm run build`: pasa, siete ZIP verificados. Se repite la compilación y
  verificación Lambda después del último ajuste de borrado parcial. Persisten
  avisos de anotaciones Rollup de Zod, sin error de compilación.
- `terraform -chdir=infra fmt -check -recursive`: pasa.
- `npm run terraform:validate`: pasan bootstrap, sandbox, demo, production y
  ephemeral. Se retiran sólo los hashes Windows añadidos por init a los lockfiles.
- TFLint de WSL: pasan las cinco raíces con los argumentos del script del repo.
- `npm run verify`: no pasa de lint:terraform porque TFLint no está en PATH
  de Windows. La comprobación WSL anterior no se presenta como un verify completo.

`npm run test:e2e` falla inicialmente por la sintaxis POSIX del comando
webServer en Windows. Se instalaron los navegadores mediante
`npm exec -- playwright install` y se preparó el mismo preview con PowerShell:

```powershell
$env:VITE_API_BASE_URL='https://api.findly.test'
$env:VITE_COGNITO_USER_POOL_ID='eu-west-1_test'
$env:VITE_COGNITO_CLIENT_ID='test-client'
$env:VITE_COGNITO_REGION='eu-west-1'
npm run build:web
npm exec vite preview -- --host 127.0.0.1 --port 4173 --strictPort
```

En otra consola, `npm run test:e2e` reutiliza ese preview: **12 pruebas pasan**
en Chromium, Firefox y WebKit. Se detuvo el preview al terminar. Son mocks HTTP,
no evidencia de CORS, firma o Rekognition en AWS.

## Límites y siguiente etapa

- La política está escrita y validada, no aplicada ni comprobada en AWS. La
  prueba Floci acredita PUT condicional, no políticas IAM ni CORS de navegador.
- No hay endpoint público nuevo ni un flujo de sustitución de selfies. `412`
  se propaga como error; no se interpreta como inscripción completada.
- El reintento de DELETE es explícito. No hay worker automático para solicitudes
  abandonadas. TTL de registro/token puede extinguir las referencias; este
  cambio no garantiza recuperación indefinida ni modifica retención.
- La lease presupone Lambda de 10 s. Falta evidencia sobre operaciones remotas
  todavía en curso tras timeout, consistencia de ListFaces, carreras con el
  matcher y purga, y recuperación cuando TTL ha eliminado también el token.
- Una URL vigente puede volver a crear el objeto después de borrarlo. La
  condición protege el objeto existente, no revoca la URL. Falta resolver esa
  limpieza tardía antes de activar el recorrido completo.
- La futura Lambda de borrado necesita UpdateItem y ListFaces con recursos
  acotados. No se conceden permisos globales ni se conecta infraestructura
  incompleta. ListFaces recorre la colección sólo en estados inciertos y puede
  aumentar latencia/coste según el tamaño del evento.

Se sincronizan specs 02, 05, 06, 09 y 18, ADR-010 y memoria de implementación.
La issue #7 permanece abierta. No hay CLI GitHub disponible ni conector de
issues en esta sesión: el comentario remoto sigue pendiente y debe enlazar
esta evidencia, las validaciones y sus límites; no hay PR que enlazar todavía.
