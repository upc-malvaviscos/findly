# Issue #5: administración, Cognito y carga de fotos

Trazabilidad: [issue #5](https://github.com/upc-malvaviscos/findly/issues/5)
y [spec 04](../../specs/04-admin-event-management-and-cognito-authorization.md).

## Alcance implementado

- Contratos TypeScript y validación Zod de eventos y solicitudes de carga.
- Gateway Cognito `USER_PASSWORD_AUTH` con configuración pública y sesión solo
  en memoria; no se guarda ningún token en `localStorage`.
- Handlers Lambda para listar/crear eventos y generar cargas JPEG, con GSI2,
  validación de evento, metadatos `Photo`, TTL y URL `PUT` de 300 segundos.
- Rutas `/admin/*` de API Gateway protegidas por JWT de Cognito, roles IAM por
  función, permisos explícitos de invocación y logs retenidos 14 días.
- UI administrativa conectada a API Gateway, selector de evento y pool de tres
  cargas simultáneas como máximo.

## Validación reproducible

```text
npm run typecheck                                                    PASS
npm test -- --run tests/web/auth.test.tsx tests/web/cognitoGateway.test.ts \
  tests/lambdas/adminEvents.test.ts tests/shared/validations.test.ts PASS
terraform -chdir=infra fmt -check -recursive                         PASS
terraform -chdir=infra validate                                      PASS
tflint --chdir=infra                                                 PASS
npm run test:aws                                                     PASS
```

La suite de autenticación verifica tanto la redirección sin sesión como la
expiración de `expiresAt`, que vuelve a renderizar login sin pantalla en blanco.
`test:aws` crea un sandbox mediante `dev:aws`, comprueba que
`GET /admin/events` sin JWT devuelve `401`, autentica un organizador Cognito
sintético y ejerce creación de evento y carga JPEG prefirmada. El smoke elimina
sus usuarios, eventos y objetos; `dev:aws-destroy -- --confirm` destruye el
sandbox y su estado remoto queda vacío.

No se versionaron ni registraron credenciales, tokens, outputs Terraform o
datos biométricos. La evidencia del ciclo AWS local está también en
[`issue-51-54-local-execution-modes.md`](issue-51-54-local-execution-modes.md).
