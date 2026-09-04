# Evidencia de galería privada local

Implementación de la galería privada con API local reproducible sobre Floci para la issue 9.

## Flujos verificados

- `/gallery?token=demo-gallery` muestra dos fotografías simuladas.
- `token=expired` muestra el estado de enlace caducado.
- Un token desconocido muestra el estado de galería no encontrada.
- Las imágenes usan carga diferida, visor modal y descarga.
- El adaptador refresca las URLs cada cuatro minutos y limpia el temporizador al desmontar.
- `GalleryReader` calcula SHA-256 del token, consulta DynamoDB y firma URLs `GET` de 300 segundos.
- `docker compose` proporciona Floci, el API local y un seeder con datos sintéticos.

## Validación

```text
npm run typecheck  PASS
npm test           PASS (15 tests)
npm run build:web  PASS
npm run build      PASS
npm run test:e2e   PASS (12 tests: Chromium, Firefox y WebKit)
npm run test:e2e:local PASS (6 tests: Chromium, Firefox y WebKit contra Floci)
```

Para levantar la integración local:

```text
docker compose up -d floci
docker compose run --rm local-seed
docker compose up local-api
VITE_API_BASE_URL=http://localhost:8787 npm run dev
```

El token demo es `demo-gallery`; el seeder solo usa datos sintéticos. AWS y Terraform quedan fuera de esta entrega.

El perfil local gestiona automáticamente el ciclo de vida de Floci: arranca los contenedores en `globalSetup`, espera la API y elimina contenedores y volúmenes en `globalTeardown`.

La consola Floci UI se habilita bajo demanda mediante el socket Docker montado en Compose y queda disponible en `http://localhost:4500/console/aws` mientras Floci está arrancado.
