# 22 - Actualización manual, descarga y enlaces compartidos de galería

<!-- requirement: REQ-GALLERY-DOWNLOAD-SHARING -->

Seguimiento: [issue #88](https://github.com/upc-malvaviscos/findly/issues/88).
Continúa spec [08](08-private-gallery-links-and-image-delivery.md); no vuelve
a implementar `GalleryReader`. La transición EMPTY/SUCCESS en el refresco
periódico ya quedó corregida por
[issue #107](https://github.com/upc-malvaviscos/findly/issues/107) (véase
`REQ-GALLERY-REFRESH-DIAGNOSTICS` en `docs/traceability.json`); esta spec no
repite ese alcance y se centra en lo que #107 deja explícitamente pendiente:
botón de actualización manual, descarga autorizada real y enlace compartido.

## Objetivo

Permitir actualizar las coincidencias de la galería sin recargar la página,
descargar cada fotografía con un contrato de autorización verificable (no solo
el atributo `download`) y compartir el enlace de acceso a la misma galería,
dejando explícitas las implicaciones de privacidad y borrado compartido.

## Alineación con AWS Well-Architected Framework

- **Seguridad**: S3 privado, tokens opacos, URLs `GET` firmadas temporales y
  descarga autorizada únicamente contra matches del token (sin aceptar claves
  S3 arbitrarias del navegador).
- **Excelencia Operativa**: estados de UI claros, errores recuperables y
  diagnóstico sin datos privados.
- **Eficiencia del Rendimiento**: actualización controlada sin recarga de SPA.

## Dependencias

Specs 08/09/18/20; issues #10 (derecho al olvido), #86 (compatibilidad de
enlaces enviados por SES), #87 (actualización de matches tras subidas
desordenadas), #89 (eliminación/revocación administrativa). Conservar 404 para
token desconocido/borrado y 410 para token conocido caducado, según el
contrato ya implementado en `src/lambdas/gallery.ts`.

Coordinación registrada en la issue (2026-10-04): sin bloqueadores entre
issues abiertas mientras se conserven los contratos de galería/token actuales;
esta spec puede avanzar en paralelo a #49. Si se propusiera cambiar
persistencia o tokens, se debe consultar #49 antes de implementarlo.

## Estado de partida (lo que ya existe)

- `GalleryPage.tsx` ya refresca periódicamente cada 4 minutos y, desde #107,
  actualiza correctamente el estado visual EMPTY/SUCCESS en ambos sentidos sin
  abandonar `ERASED` ante respuestas tardías.
- La descarga actual es un enlace `<a href={url} download target="_blank">`
  que reutiliza la misma URL `GET` firmada de visualización inline. Al ser
  cross-origin hacia S3, el atributo `download` no garantiza la descarga real
  del archivo en todos los navegadores; la prueba existente
  (`tests/web/gallery.test.tsx`, "renders a real download control") solo
  verifica `href`/`download`, no el contenido descargado.
- No existe ninguna acción de copiar/compartir enlace en `GalleryPage.tsx`.

## Especificación Backend & Frontend

### Lambda `GalleryReader` (`src/lambdas/gallery.ts`)

- Mantener el contrato `GET /gallery?token=` sin cambios de autorización ni de
  claves DynamoDB.
- Acordar el contrato de descarga autorizada: una URL `GET` firmada con
  `ResponseContentDisposition: attachment; filename="<nombre-seguro>"`,
  generada en el servidor a partir del `photoId` ya autorizado para ese token
  (no a partir de una clave S3 recibida del navegador). Puede reutilizar la
  consulta de matches existente y emitir, junto a la URL de visualización
  inline, una segunda URL (o el mismo endpoint con un parámetro explícito)
  pensada para forzar descarga.

### Vista Frontend de Galería (`GalleryPage.tsx`)

- **Botón «Actualizar fotos»**: acción manual equivalente al refresco
  periódico existente (misma función de refresco), con estado de
  progreso/error visible y sin recarga ni navegación. Debe tolerar respuestas
  fuera de orden y el visor (`lightbox`) abierto durante el refresco.
- **404/410 durante refresco**: si una actualización (manual o periódica)
  devuelve `GALLERY_NOT_FOUND` o `GALLERY_EXPIRED`, detener el refresco
  periódico y mostrar el estado correspondiente en vez de mantener datos
  visuales obsoletos.
- **Descarga real por foto**: usar el contrato de descarga autorizada del
  backend; conservar la visualización inline con la URL existente. La
  comprobación de aceptación exige verificar el archivo JPEG descargado
  (nombre y contenido) contra S3 real en Chromium/Firefox/WebKit, no solo el
  atributo `download`.
- **Compartir/copiar enlace**: acción explícita que copia la URL completa de
  la galería (origen + `?token=`) al portapapeles (o usa `navigator.share`
  cuando esté disponible), con confirmación visual. Debe mostrar una
  advertencia de que quien reciba el enlace puede ver, descargar **y también
  borrar la inscripción** (sin separar propietario/lector en el MVP), y que
  compartir no amplía la retención ni garantiza revocación instantánea de las
  URLs de S3 ya emitidas.

## Guía de Implementación Paso a Paso

1. Backend: acordar y documentar el contrato de descarga con
   `ResponseContentDisposition`, autorizado solo contra matches del token;
   actualizar `src/lambdas/gallery.ts` y sus pruebas de contrato.
2. Frontend: añadir el botón de actualización manual reutilizando la lógica de
   refresco ya corregida por #107; propagar 404/410 de cualquier refresco al
   estado de la página.
3. Frontend: sustituir el enlace de descarga actual por el contrato autorizado
   y añadir una prueba que verifique el archivo descargado real (no solo el
   atributo `download`), contra S3 real o un doble fiel de origen distinto.
4. Frontend: añadir la acción de copiar/compartir con su advertencia de
   borrado compartido.
5. Probar el enlace compartido desde un navegador distinto sin sesión previa y
   confirmar que un borrado desde cualquiera de los dos invalida la
   inscripción para ambos.

## Errores comunes a evitar (Pitfalls)

- ❌ Dejar `EMPTY` fijo tras un refresco manual o periódico que sí trae
  coincidencias (ya corregido por #107; no reabrir la regresión).
- ❌ Dar por probada la descarga real comprobando solo `href`/`download`; hay
  que verificar el archivo descargado.
- ❌ Afirmar que compartir el enlace es "solo lectura" o que nunca caduca: el
  poseedor puede borrar la inscripción y las URLs de S3 ya emitidas siguen
  siendo válidas hasta su expiración natural.
- ❌ Aceptar una clave S3 arbitraria enviada por el navegador para construir la
  URL de descarga; debe derivarse siempre de un match ya autorizado para el
  token.

## Criterios de aceptación y verificación

- [ ] Refresco manual sin recarga; estados EMPTY/SUCCESS y errores
      recuperables visibles.
- [ ] Refresco automático y 404/410 (manual o periódico) gestionados sin dejar
      datos visuales obsoletos.
- [ ] JPEG descargado con nombre y contenido correctos en
      Chromium/Firefox/WebKit contra S3 real (o doble fiel de otro origen); no
      basta comprobar `href`/`download`.
- [ ] Visualización inline se conserva y se rechazan descargas de claves S3
      ajenas al token.
- [ ] Compartir abre la misma galería en otro navegador sin login.
- [ ] Advertencia de capacidad de borrado compartido visible antes de copiar
      el enlace, y prueba de que el borrado invalida la inscripción para
      ambos navegadores.
- [ ] Sin tokens ni identidad en logs, `localStorage` ni artefactos de prueba.
- [ ] Pruebas unitarias/E2E actualizadas; evidencia AWS/demo separada de
      mocks/Floci.
- [ ] Specs 08/22, runbook (#18) e issue #88 sincronizados; gates en verde.

## Estado de implementación

Implementado en `src/lambdas/gallery.ts` (URL de descarga autorizada con
`ResponseContentDisposition: attachment; filename="findly-<photoId>.jpg"`,
derivada del `s3Key` ya autorizado por el match, nunca de una clave enviada
por el navegador) y `src/web/components/gallery/GalleryPage.tsx` (botón
«Actualizar fotos» manual que reutiliza la función de refresco existente,
propagación de 404/410 desde cualquier refresco con parada del temporizador
periódico, enlace de descarga apuntando a la URL de adjunto en vez de la de
visualización inline, y acción «Copiar enlace de la galería» con advertencia
de borrado compartido visible antes de copiar).

La invalidación del enlace compartido tras un borrado («cualquiera de los dos
navegadores invalida la inscripción para ambos») es una propiedad ya existente
de `deleteRegistration` (un único token compartido, no dos independientes); no
se duplica esa prueba aquí.

Validación local: 612 pruebas unitarias/contrato en verde (incluye 1 nueva en
`tests/lambdas/gallery.test.ts` y 4 nuevas/actualizadas en
`tests/web/gallery.test.tsx`), lint, TypeScript y build en verde; 8 pruebas
E2E nuevas/actualizadas en `e2e/foundation.spec.ts` en Chromium/Firefox/WebKit
(36/39 del fichero completo; 3 omitidas y documentadas: verificación de bytes
descargados en WebKit, por una limitación conocida de la automatización de
Playwright con rutas interceptadas —no del contrato HTTP—, y el flujo de
portapapeles en Firefox/WebKit, cuyo permiso de `clipboard` Playwright solo
puede concederse en Chromium). Evidencia completa:
[issue-88-gallery-refresh-download-sharing.md](../docs/evidence/issue-88-gallery-refresh-download-sharing.md).

Pendiente, fuera del alcance de esta spec: verificación contra AWS/S3 real
(issue #88 no autoriza ejecutar AWS en esta sesión) y el resto de criterios
marcados como tales en la issue.
