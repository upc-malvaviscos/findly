# 08 - Galería privada y entrega de imágenes

## Objetivo
Proporcionar acceso seguro y exclusivo a las fotografías donde ha coincidido el rostro del asistente registrado, utilizando enlaces con tokens opacos temporales y entrega de imágenes a través de URLs `GET` prefirmadas de Amazon S3 en una SPA React + Vite.

## Alineación con AWS Well-Architected Framework
- **Seguridad**: Tokens aleatorios almacenados únicamente como hash SHA-256 (`tokenHash`), URLs S3 prefirmadas `GET` de 300s y buckets 100% privados.
- **Eficiencia del Rendimiento**: Galería React con carga diferida (`loading="lazy"`), esqueletos animados y visor modal Lightbox.

## Especificación Backend & Frontend

### Lambda `GalleryReader`
- Configuración: `memory_size = 256`, `timeout = 5`.
- Petición: `GET /gallery?token=XYZ`.
- Hash SHA-256: `crypto.createHash('sha256').update(token).digest('hex')`.
- Consulta DynamoDB `PK = TOKEN#{tokenHash}` -> recupera `registrationId` -> consulta `MATCH#{photoId}`.
- Genera URLs S3 `GET` prefirmadas con `@aws-sdk/s3-request-presigner` (`expiresIn: 300`).

### Vista Frontend de Galería React (`/gallery?token=`)
- Componentes: `GalleryPage`, `GalleryGrid`, `ImageLightbox`, `DownloadButton`, `RightToErasureButton`.
- Estados de UI: `LOADING`, `SUCCESS`, `EMPTY`, `EXPIRED`, `NOT_FOUND`.
- Refresco de URLs: Mecanismo automático en cliente que solicita nuevas URLs antes de cumplir los 4 minutos.

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Implementar la Lambda `GalleryReader`
- En `build/lambdas/api/gallery.ts`, parsea `event.queryStringParameters.token`.
- Valida la existencia del tokenHash en DynamoDB y genera las URLs prefirmadas.

### Paso 2: Construir la Pantalla React (`GalleryPage.tsx`)
- En `src/pages/GalleryPage.tsx`, parsea el token de la URL usando React Router (`useSearchParams`).
- Realiza el `fetch` a API Gateway y gestiona los 5 estados de UI (`LOADING`, `SUCCESS`, etc.).

## Errores Comunes a Evitar (Pitfalls)
- ❌ **ERROR**: Imprimir el token en texto claro en `console.log` o logs de CloudWatch.
  - *Solución*: Muestra únicamente los primeros 4 caracteres o el hash anonimizado.
- ❌ **ERROR**: Dejar que las URLs de S3 caduquen mientras el usuario mira la galería.
  - *Solución*: Implementa el temporizador de refresco silencioso de URLs a los 4 minutos.

## Lista de Verificación Pre-PR (Junior Checklist)
- [ ] Peticiones con token no existente o caducado devuelven error HTTP 404 limpiamente.
- [ ] Las imágenes cargan con URLs prefirmadas y el botón de descarga funciona.
- [ ] La interfaz maneja el estado vacío cuando no hay fotos coincidentes publicadas.
