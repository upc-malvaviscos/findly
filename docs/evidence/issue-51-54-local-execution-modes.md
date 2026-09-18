# Evidencia reproducible: issues 51 a 54

## Trazabilidad

- [#51](https://github.com/upc-malvaviscos/findly/issues/51): épica cerrada
  de modos locales y matriz de pruebas.
- [#52](https://github.com/upc-malvaviscos/findly/issues/52): mocks y pruebas
  unitarias del organizador, cerrada.
- [#53](https://github.com/upc-malvaviscos/findly/issues/53): Floci e
  integración local, cerrada.
- [#54](https://github.com/upc-malvaviscos/findly/issues/54): sandbox AWS,
  smoke real y destrucción explícita, cerrada.
- [#17](https://github.com/upc-malvaviscos/findly/issues/17): validación
  integral, cerrada.

## Implementación integrada

- PR #55 separó los modos `mock`, `floci` y `aws`, añadió los comandos de
  desarrollo y pruebas, y enlazó sus guías desde `AGENTS.md`.
- PR #56 hizo opcional `AWS_PROFILE`, conservando una cadena de credenciales
  AWS activa cuando no se selecciona perfil.
- PR #57 exportó credenciales temporales sólo a procesos AWS/Terraform y a los
  clientes SDK del smoke; Vite no recibe esas credenciales.

## Verificaciones ejecutadas

| Comando o flujo                        | Resultado                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `npm run verify`                       | Correcto: 94 pruebas, tipos, compilación, Terraform estático, seguridad y sincronización documental.                           |
| `npm run test:e2e`                     | Correcto: 12 pruebas en Chromium, Firefox y WebKit.                                                                            |
| `npm run test:floci`                   | Correcto: recorrido de organizador, evento, subida y galería con teardown de Compose.                                          |
| `npm run dev:aws`                      | Correcto: `terraform apply` de sandbox, usuario Cognito temporal y Vite local.                                                 |
| `npm run test:aws`                     | Correcto: autenticación, API admin, subida prefirmada, galería `200`, token desconocido `404`, expirado `410` y galería vacía. |
| `npm run dev:aws-destroy -- --confirm` | Correcto: sandbox destruido; estado Terraform remoto sin recursos y User Pool temporal inexistente.                            |

## Límites y seguridad

Se emplearon exclusivamente usuarios, eventos, tokens, objetos JPEG y datos de
galería sintéticos. No se registraron contraseñas, tokens, outputs Terraform,
identificadores de cuenta ni datos biométricos. El entorno AWS efímero de PR
continúa siendo una evidencia independiente: provisiona, prueba y destruye con
OIDC por pull request.

## Contrato de sincronización

Al cerrar una implementación se actualizan conjuntamente código, esta evidencia,
la spec 19 y la issue GitHub. `npm run sync:check` comprueba esta trazabilidad
estática en CI; la sincronización del estado remoto de la issue (comentario,
casillas y cierre) se revisa en la fase Sync definida por `AGENTS.md`.
