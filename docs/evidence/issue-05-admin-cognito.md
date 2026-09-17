# Issue #5: administración, Cognito y carga de fotos

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
  tests/lambdas/adminEvents.test.ts tests/shared/validations.test.ts PASS (10)
terraform -chdir=infra fmt -check -recursive                         PASS
terraform -chdir=infra validate                                      PASS
tflint --chdir=infra                                                 PASS
```

No se ejecutó `terraform apply` ni se usaron credenciales o datos biométricos.
La prueba integrada contra AWS queda pendiente de un entorno gestionado con
estado remoto, variables de despliegue y organizadores Cognito creados fuera
del repositorio.
