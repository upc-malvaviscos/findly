# Issue #181: contrato Terraform/IAM y preflight

<!-- requirement: REQ-DEPLOYMENT-PERMISSIONS -->

Fecha: 2026-10-25. [Issue #181](https://github.com/upc-malvaviscos/findly/issues/181).
Decisión: [ADR-026](../adr/ADR-026-terraform-permission-contract.md).

## Evidencia por plano

| Plano          | Evidencia de esta entrega                                                                                        | Límite                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Código         | Generador corregido, grafo Terraform con proveedor simulado, regresiones y preflight en CI/Deployment existentes | No aplica IAM ni despliega                                                      |
| IAM aplicado   | Sin nuevas lecturas ni aplicaciones AWS en esta tarea; el lector se prueba con adaptador falso                   | Las versiones y permisos efectivos requieren operación autorizada independiente |
| Operación real | Sin nuevo despliegue ni aceptación AWS                                                                           | Un merge o un mock no acredita administración, backfill o correo disponibles    |

Antecedente operativo:
[Deployment 40137794179](https://github.com/upc-malvaviscos/findly/actions/runs/40137794179),
con apply parcial. Esta entrega no repite ese ensayo ni resuelve carreras/TTL
de #166 y #171–#174 o la aceptación de recuperación #175.
Las operaciones IAM/despliegue permanecen en
[#179](https://github.com/upc-malvaviscos/findly/issues/179) y
[#180](https://github.com/upc-malvaviscos/findly/issues/180), que no se cierran
por esta entrega del contrato de CI/preflight.

## Criterios de #181

| Criterio                                            | Implementación y prueba                                                                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contrato de inventario/despliegue/runtime           | `terraform-permission-inventory.mjs` obtiene el grafo desde JSON; `deployment-permission-contract.mjs` recorre recursos/políticas sin una lista de módulos |
| Regresiones de función/cola/boundary                | `deploymentPermissionContract.test.ts` introduce recursos sin cubrir y retira `BatchWriteItem` o acceso a backfill                                         |
| Semántica de ownership/tags/región/PassRole/mapping | Allow/deny con negativos, cobertura de patrones completos y propiedad actual frente a tags solicitados                                                     |
| Preflight antes de mutaciones donde es viable       | Step entre plan/apply, sin `continue-on-error`; lector paginado, fallo de lecturas y boundary aplicada obsoleta probados con adaptador falso               |
| Checks conservados y validación local sin AWS       | `permissions:check` en `verify` y job Terraform; sin nuevo workflow ni aprovisionamiento                                                                   |
| Separación de evidencia                             | Matriz de código/IAM/operación anterior y límites de ADR-026                                                                                               |

## Verificación reproducible

```sh
npm ci
npm run harness:check
npm run build:lambdas
npm run package:lambdas
npm run permissions:check
npm run verify
```

El contrato completo obtuvo **186 recursos, 22 funciones, 23 roles y 8 colas**;
comprueba **587 casos de despliegue y 150 de runtime** con correo opcional
activado en una fixture pública sintética. Se prueba además adaptar el grafo
completo a un plan con ARNs, roles y políticas todavía desconocidos.
El preflight completo se compone sobre ese mismo grafo con STS/IAM falso tanto
para creación como para recursos existentes sin cambios; no se ejecuta AWS.

Regresiones: `tests/infra/deploymentPermissionContract.test.ts`,
`appliedProductionPolicies.test.ts` y `productionPlanInventory.test.ts`.
No usan procesos AWS ni envían mensajes. Se reemplaza el test anterior de ocho
módulos enumerados por el recorrido de todos los roles/políticas del grafo.
Permanecen los tests de aislamiento y límites de tamaño de políticas.

Las **63 regresiones nuevas** pasan, incluidos fallos de lecturas IAM,
boundary aplicada obsoleta o excesiva, grants de despliegue excesivos e
intersección con su boundary, propiedad anterior, valores desconocidos, comodines
literales en `StringEquals` y rechazo de tablas/colas de otra cuenta/entorno.
`BatchWriteItem` queda limitado a la tabla, excluyendo sus índices; la cola de
backfill se permite sin conceder consumo de su DLQ. La comparación del
generador demo contra `origin/main`, con y sin bindings exactos, obtuvo
documentos deploy/destroy/trust idénticos.

`verify` incluye lint/actionlint/TFLint, tipos, pruebas, build, contratos
Terraform, el nuevo contrato de permisos, seguridad y `sync:check`. Los hooks
se conservan y el pre-push vuelve a ejecutar la validación completa. El alcance
no cambia el recorrido web; la E2E ordinaria se conserva en CI.

## Operación futura

El preflight recibe el plan del mismo run por stdin, sin publicarlo. Comprueba
entradas/namespace y una simulación fresca; luego lee las políticas actuales
del rol `findly-production-deploy` y la boundary runtime. Una lectura denegada
o un hueco bloquea el apply. El workflow no puede concederse lecturas ni
modificar la boundary: revisar/aplicar IAM exige otra autorización.

SCP, políticas de sesión, resource policies, deriva concurrente, cuotas y todos
los RPC AWS posibles quedan fuera del evaluador local. Un `allowed` no prueba
una operación AWS. No se afirma aquí qué versiones IAM están aplicadas ni que
el despliegue parcial esté reparado o publicado.
