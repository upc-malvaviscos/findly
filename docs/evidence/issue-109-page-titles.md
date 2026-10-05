# Evidencia #109: títulos de página y tarjeta para compartir

<!-- requirement: REQ-PAGE-TITLES -->

## Cambio

`RoutedApp` actualiza el título según la pantalla visible, incluyendo cambios
de sesión y el formulario de contraseña definitiva. El HTML inicial utiliza
el título de portada mientras se carga React. No hay nuevas dependencias ni
cambios en rutas, contratos AWS o permisos.

| Pantalla                                    | Título                       |
| ------------------------------------------- | ---------------------------- |
| Portada e inscripción                       | Encuentra tus fotos · Findly |
| Login, incluido acceso protegido sin sesión | Iniciar sesión · Findly      |
| Primera contraseña de organizador           | Elige tu contraseña · Findly |
| Administración autenticada                  | Eventos · Findly             |
| Galería privada                             | Tu galería · Findly          |

Los títulos no incluyen tokens, nombres de asistentes ni correos. La galería
conserva el mismo título para sus estados vacío, disponible, caducado o borrado.

## Tarjeta para compartir

`public/og-findly.png` es una tarjeta de marca de 1200 × 630 píxeles, con los
colores y el símbolo del favicon. Su fuente editable es `public/og-findly.svg`;
se renderizó con Chromium mediante Playwright, sin fotografías de personas.
El texto reproduce «Encuentra tu momento» y «Tus recuerdos, encontrados».

`index.html` incluye descripción, Open Graph y Twitter con tarjeta grande,
texto alternativo y URL absoluta de la imagen pública. Estos metadatos están
en el HTML inicial. Todas las rutas comparten la misma tarjeta genérica y la
URL pública de portada, sin copiar parámetros, tokens ni datos de asistentes.

Se inspeccionó visualmente el PNG, y se comprobaron sus dimensiones, la copia
exacta en `dist/` y las referencias de imagen en el HTML compilado mediante
`npm run build:web`. La previsualización en proveedores externos queda pendiente
del despliegue y de la actualización de sus cachés.

## Verificación

Los recorridos E2E existentes comprueban los títulos de portada, galería,
acceso protegido, entrada/salida de sesión y elección de contraseña en
Chromium, Firefox y WebKit. Usan identidades y backend simulados; no acreditan
Cognito, matching AWS ni publicación de producción.

Validación local: `npm run verify` PASS (603 pruebas, lint, TypeScript, build,
validación y contratos Terraform, seguridad y 12 requisitos de trazabilidad);
`npm run test:e2e` PASS (24 recorridos con las aserciones de títulos en los tres
navegadores). Sin cambios de infraestructura ni pruebas AWS adicionales.

La validación remota se registra en la PR y la issue #109. La entrega no se
declara desplegada desde un build o una PR abierta. Es independiente de la
corrección de refresco de #107/#108.
