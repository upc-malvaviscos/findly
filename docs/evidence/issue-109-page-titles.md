# Evidencia #109: títulos de página

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
