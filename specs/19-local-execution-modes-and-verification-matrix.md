# 19 - Modos locales y matriz de verificación

## Objetivo

Hacer explícitos y reproducibles los tres planos de ejecución de Findly: todo
local con mocks, local con Floci y local contra un sandbox AWS. Cada plano debe
declarar qué prueba y qué no prueba, para que una señal verde no se interprete
como evidencia de otro entorno.

## Estado implementado

La épica [#51](https://github.com/upc-malvaviscos/findly/issues/51) y sus
subissues están cerradas:

| Plano       | Issue                                                      | Comandos                                                                      | Evidencia alcanzada                                                                                                 |
| ----------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Mocks       | [#52](https://github.com/upc-malvaviscos/findly/issues/52) | `npm run dev:mocks`, `npm run test:unit`                                      | Login local del organizador, admin simulado y redirección `/admin` sin Docker ni AWS.                               |
| Floci       | [#53](https://github.com/upc-malvaviscos/findly/issues/53) | `npm run dev:floci`, `npm run test:floci`                                     | Lambda/API local, DynamoDB/S3 emulados, login sintético, eventos, subida y galería; teardown Compose.               |
| AWS sandbox | [#54](https://github.com/upc-malvaviscos/findly/issues/54) | `npm run dev:aws`, `npm run test:aws`, `npm run dev:aws-destroy -- --confirm` | Cognito, API Gateway, Lambda, DynamoDB, S3 y firmas reales con datos sintéticos; estado remoto vacío tras destruir. |

La validación integral original está cerrada en
[#17](https://github.com/upc-malvaviscos/findly/issues/17). Las PR
[#55](https://github.com/upc-malvaviscos/findly/pull/55),
[#56](https://github.com/upc-malvaviscos/findly/pull/56) y
[#57](https://github.com/upc-malvaviscos/findly/pull/57) contienen,
respectivamente, la separación inicial, la selección de cadena de credenciales
y la exportación efímera que permite a Terraform usar una sesión AWS activa.

## Restricciones operativas

- Mocks no demuestran AWS, red, CORS ni Cognito real.
- Floci no demuestra IAM, Cognito ni servicios AWS gestionados.
- El sandbox AWS no es producción ni el entorno efímero de una PR; usa el
  backend cifrado y bloqueado `findly/sandbox/terraform.tfstate` y datos
  exclusivamente sintéticos.
- Las credenciales temporales se exportan sólo a subprocesos AWS y Terraform;
  no se escriben, registran ni pasan a Vite.
- Un `destroy` requiere `--confirm` y sólo usa el estado remoto del sandbox.

## Criterios de aceptación

- [x] Los tres planos tienen comandos explícitos y documentación ejecutable en
      [`docs/execution-modes.md`](../docs/execution-modes.md).
- [x] La estrategia separa unitarias con mocks, integración Floci y smoke AWS
      en [`docs/testing-strategy.md`](../docs/testing-strategy.md).
- [x] El smoke AWS real verificó autenticación, administración, subida y
      galerías `200`, `404`, `410` y vacía; después destruyó el sandbox.
- [x] La trazabilidad de implementación, spec, evidencia e issue se comprueba
      con `npm run sync:check`.

## Evidencia

Consulta
[`docs/evidence/issue-51-54-local-execution-modes.md`](../docs/evidence/issue-51-54-local-execution-modes.md)
para los comandos ejecutados, resultados y verificación de limpieza.
