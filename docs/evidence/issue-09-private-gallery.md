# Evidencia de galería privada frontend

Implementación de la interfaz de galería con adaptador simulado para la issue 9.

## Flujos verificados

- `/gallery?token=demo-gallery` muestra dos fotografías simuladas.
- `token=expired` muestra el estado de enlace caducado.
- Un token desconocido muestra el estado de galería no encontrada.
- Las imágenes usan carga diferida, visor modal y descarga.
- El adaptador refresca las URLs cada cuatro minutos y limpia el temporizador al desmontar.

## Validación

```text
npm run typecheck  PASS
npm test           PASS (9 tests)
npm run build:web  PASS
npm run test:e2e   PASS (9 tests: Chromium, Firefox y WebKit)
```

La integración con `GalleryReader`, DynamoDB y URLs GET prefirmadas de S3 no forma parte de esta entrega frontend.
