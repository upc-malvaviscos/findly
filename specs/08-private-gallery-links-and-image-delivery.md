# 08 - Galería privada y entrega de imágenes

## Objetivo
Proporcionar acceso seguro y exclusivo a las fotografías donde ha coincidido el rostro del asistente registrado, utilizando enlaces con tokens opacos temporales y entrega de imágenes a través de URLs `GET` prefirmadas de Amazon S3.

## Requisitos de Seguridad y Tokens de Galería
- **Generación de Token**: Cadena alfanumérica aleatoria de 32 bytes enviada al usuario o mostrada tras la inscripción.
- **Almacenamiento Seguro**: El backend únicamente almacena el hash **SHA-256** del token (`tokenHash`) en DynamoDB (`TOKEN#{tokenHash}`). Nunca guardar ni registrar el token en texto claro en logs de CloudWatch ni en base de datos.
- **Caducidad (TTL)**: Tiempo de vida configurable (ej. 7 días), tras los cuales el registro en DynamoDB se elimina automáticamente.
- **URLs de Imagen**: Generación de URLs `GET` prefirmadas de S3 con validez corta de 300 segundos (5 minutos) generadas vía `@aws-sdk/s3-request-presigner`. No publicar buckets S3 públicamente ni utilizar ACLs públicas.

## Especificación Backend (Lambda `GalleryReader`)
- Configuración Lambda: `memory_size = 256`, `timeout = 5`.
- Flujo de Ejecución:
  1. Recibir `token` desde la petición HTTP GET `/gallery?token=XYZ`.
  2. Calcular hash en memoria: `tokenHash = crypto.createHash('sha256').update(token).digest('hex')`.
  3. `GetItem` en DynamoDB con `PK = TOKEN#{tokenHash}`. Si no existe o `expiresAt` < Date.now(), devolver HTTP 404 Not Found.
  4. `Query` en DynamoDB con `PK = REG#{registrationId}` para obtener los ítems `MATCH#{photoId}`.
  5. Por cada foto coincidente, generar la URL `GET` prefirmada de S3 con expiración en 300 segundos.
  6. Devolver el payload JSON con la lista de fotos y URLs prefirmadas.

## Especificación Frontend de la Galería (`/gallery?token=`)

### Componentes de la Interfaz
- `GalleryPage`: Página de carga en `/gallery`. Parsea el parámetro URL `?token=...`.
- `GalleryGrid`: Rejilla responsiva optimizada (CSS Grid / Tailwind) con carga diferida de imágenes (`loading="lazy"`).
- `ImageLightbox`: Visor modal a pantalla completa al hacer clic en una foto, con controles de zoom y navegación por teclado.
- `DownloadButton`: Acceso directo para descargar la fotografía en alta resolución utilizando la URL prefirmada S3.
- `RightToErasureButton`: Botón en pie de página que permite al usuario solicitar el borrado de sus fotos y datos biométricos.

### Estados de la Interfaz de Usuario
- `LOADING`: Muestra esqueletos animados (Skeletons) mientras se consulta la API `GET /gallery?token=...`.
- `SUCCESS`: Muestra el listado de fotos coincidentes y la fecha de caducidad del acceso.
- `EMPTY`: Muestra una ilustración y mensaje si el proceso se ejecutó pero aún no hay fotos coincidentes publicadas.
- `EXPIRED`: Muestra aviso de token o galería caducada, indicando que el acceso ha finalizado por política de retención.
- `NOT_FOUND`: Token inválido o datos purgados a petición del usuario.

### Estrategia de Refresco de URLs S3
- Dado que las URLs prefirmadas de S3 expiran en 5 minutos, la galería implementa un mecanismo en cliente que, al detectar inactividad o antes de cumplir los 4 minutos, solicita un refresco transparente de URLs a la API para evitar imágenes rotas durante la navegación activa.

## Criterios de Aceptación
- Peticiones con token inválido o caducado devuelven un error HTTP 404 Not Found genérico sin revelar información de la base de datos.
- Intentar acceder directamente a un objeto S3 sin URL prefirmada o con una URL vencida devuelve 403 Forbidden.
