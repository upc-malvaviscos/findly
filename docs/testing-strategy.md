# Estrategia de pruebas por entorno

Cada suite declara el entorno que usa. Una comprobación verde en un plano no
demuestra automáticamente los contratos de los otros.

| Nivel                 | Comando              | Prueba                                              | No prueba                     |
| --------------------- | -------------------- | --------------------------------------------------- | ----------------------------- |
| Unitarias con mocks   | `npm run test:unit`  | Componentes, contratos y adaptadores aislados       | AWS, red, CORS o Cognito real |
| Integración con Floci | `npm run test:floci` | Lambda/API local, DynamoDB/S3 emulados, UI y subida | Cognito, IAM y AWS real       |
| Smoke AWS             | `npm run test:aws`   | Cognito, API Gateway, Lambda, DynamoDB, S3 y firmas | Producción o biometría real   |

## Unitarias con mocks

```sh
npm run test:unit
```

Vitest debe cubrir lógica, estados visibles y contratos sin llamadas externas.

## Floci

```sh
npm run harness:check:e2e
npm run test:floci
```

La suite adicional `npm run test:floci:integration` invoca
SelfieIndexer con eventos S3 construidos en el test, usa DynamoDB y S3 de un
contenedor Floci aislado y simula únicamente Rekognition. Comprueba persistencia,
GSI1, duplicados, escrituras condicionales concurrentes, recuperación del bloqueo
y borrado durante el procesamiento. No demuestra reconocimiento facial,
notificaciones S3 a Lambda, IAM ni comportamiento AWS real.

El comando `npm run test:floci` ejecuta Playwright e inicia y destruye Compose. Comprueba galería, estados de token,
login local de organizador, eventos y subida. Para depurar manualmente, usa
`npm run dev:floci`.

La suite de integración aislada requiere Node.js 24, dependencias instaladas y
Docker Compose; no requiere navegadores. Usa un proyecto aleatorio, puerto
loopback libre y datos sintéticos, y elimina sus recursos al terminar incluso
si una prueba falla. Puede ejecutarse junto a una sesión manual de Floci.
El tramo Playwright de `test:floci` conserva su ciclo Compose habitual; no lo
ejecutes sobre el mismo proyecto Compose de una sesión manual con datos a conservar.

## AWS sandbox

```sh
FINDLY_TERRAFORM_STATE_BUCKET=<bucket> npm run test:aws
```

Exige un sandbox creado mediante `dev:aws` y exporta temporalmente las credenciales
activas sólo a sus procesos AWS. El smoke genera usuario, eventos,
objetos y tokens aleatorios; valida autenticación, administración, subida y
los contratos `200`, `404`, `410` y galería vacía; después elimina sus datos.

## CI

CI ordinaria ejecuta unitarias y Floci. El workflow de PR usa un stack AWS
efímero con OIDC, datos sintéticos y `destroy`, una evidencia AWS independiente.
El sandbox compartido no se consume automáticamente desde CI.
