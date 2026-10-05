# Evidencia #107: galería vacía y refresco

<!-- requirement: REQ-GALLERY-REFRESH-DIAGNOSTICS -->

## Incidencia observada el 2026-10-05

Inspección AWS de sólo lectura de producción, sin descargar imágenes ni
registrar identificadores de asistentes, tokens, contactos o datos biométricos:

| Hora Europe/Madrid | Señal                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| 19:23:22           | Tres fotos fallan en `index_faces` con `ResourceNotFoundException`; los lotes solicitan reentrega. |
| 19:23:53           | `selfie_indexed`: se completa la inscripción.                                                      |
| 19:24:02           | GalleryReader responde 200 y `photoCount: 0`.                                                      |
| 19:26:22–19:26:23  | Las tres fotos terminan de procesarse; `failedCount: 0`.                                           |

Una lectura consistente posterior encontró una inscripción ENROLLED y tres
MATCH asociados. La cola principal y DLQ quedaron sin mensajes visibles,
invisibles o diferidos en la comprobación posterior. El responsable confirmó
que recargar la galería muestra las tres fotos. Los contadores SQS son
aproximados; no se presenta esta observación como garantía general de tiempos.

Los logs y el contrato muestran la secuencia compatible con fotos recibidas
antes de crear la colección mediante SelfieIndexer. No se ejecutaron llamadas
Rekognition sobre imágenes reales, redrive ni reprocesamiento manual. El fallo
de colección se recuperó mediante la reentrega existente; no se modifica ese
contrato ni se resuelve el matching histórico de #87.

## Reproducción y corrección

```sh
npm exec -- vitest run tests/web/gallery.test.tsx -t 'shows matches that arrive'
```

Antes de corregir: FAIL, el componente mantiene «Aún no hay fotos» después de
que el refresco devuelva una fotografía. El comando tarda menos de un segundo
con tiempo simulado y usa sólo datos sintéticos.

El refresco guardaba la respuesta pero no cambiaba EMPTY a SUCCESS. La
corrección actualiza ambos y conserva ERASED cuando un refresco iniciado antes
del borrado responde después. Se conserva el intervalo de cuatro minutos.

Se añade una prueba E2E de vacío → foto en Chromium, Firefox y WebKit, una
regresión de refresco tardío tras borrado y pruebas de saneado del diagnóstico
CLI. Las pruebas simuladas no acreditan reconocimiento facial ni despliegue.

## Diagnóstico operativo

[Runbook](../runbooks/matching-troubleshooting.md) y
`scripts/diagnose-matching.mjs`: lectura acotada de logs con AWS CLI, cuenta
comprobada y salida sin campos privados. Las páginas incompletas se indican
explícitamente. No cambia permisos ni infraestructura.

## Validación y entrega

Validación local: `npm run verify` PASS (607 pruebas, lint, TypeScript,
build, validación Terraform, contratos hosting/certificado/correo, seguridad y
12 requisitos de trazabilidad); `npm run test:e2e` PASS (27 pruebas en tres
navegadores); `npm run harness:check` PASS. El diagnóstico CLI se ejecutó contra
los tres grupos de logs reales y produjo salida saneada, con páginas
incompletas señaladas. Se observó además GalleryReader 200 con tres fotos tras
la recarga. Las pruebas de interfaz usan backend simulado.

La validación remota se registra en la PR y la issue #107. La observación de
producción describe el código anterior: la corrección requiere integración y
despliegue posterior.
Las issues #18, #87, #88, #98, #86 y #49 conservan sus pendientes.
