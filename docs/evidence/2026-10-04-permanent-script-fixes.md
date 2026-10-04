# Correcciones permanentes de los scripts — 2026-10-04

<!-- requirement: REQ-SCRIPTS-RELIABILITY -->

## Alcance

Se corrigen los cuatro hallazgos de la auditoría de `scripts` sobre
`main@df175bc`: validación Terraform que modificaba el checkout, control de
documentación por frases históricas y dos rutas que ocultaban fallos de limpieza.
La rama incorpora `main@d52d5b2` (PR #95) y conserva íntegramente su evidencia
de demo al añadir los metadatos de trazabilidad.

La omisión de `telemetry` en el inventario de destrucción ya fue corregida en
PR #94; esta entrega conserva esa corrección.

## Comportamiento y regresiones

- Terraform: copia desechable de las cinco raíces y módulos, backend local solo
  en la copia, datos/caché independientes y lockfiles de proveedores en modo
  readonly. No copia estados, overrides, datos inicializados ni variables
  locales; elimina la copia también tras un fallo. No ejecuta apply/destroy.
- Documentación: `docs/traceability.json` relaciona ocho requisitos estables con
  issues, specs, implementación, comandos/pruebas, documentos y evidencia por
  entorno. El validador rechaza referencias ausentes, identificadores duplicados,
  comandos desconocidos y rutas que escapan del repositorio. Las declaraciones
  en specs/evidencias enlazan el requisito sin exigir frases o runs históricos.
- Smoke sandbox: registra limpieza antes de escrituras/subidas, espera todas las
  escrituras antes de limpiar, intenta todas las eliminaciones incluso si una
  falla y devuelve error si quedan fallos. Solo informa éxito después de limpiar.
- Sesión sandbox: intenta borrar el organizador incluso si falla su creación,
  contraseña o arranque de Vite. Controla salida/error/señales del proceso y falla
  si la eliminación falla; un usuario confirmado como inexistente es idempotente.

Las pruebas inyectan fallos síncronos/asíncronos, fallos de arranque, señales,
referencias eliminadas y un checkout con override/backend/estado preexistentes.
Los diagnósticos de limpieza usan tipos de recurso, sin volcar respuestas AWS,
credenciales ni tokens. El error original se conserva junto con los fallos de
limpieza.

## Reproducción y límites

```sh
npm ci
npm run harness:check
npm run test -- --project infra
npm run verify
```

Resultados locales (Node 24.20.0):

- `harness:check`: correcto.
- `verify`: correcto; 385 pruebas en 47 archivos, lint, formato, Markdown,
  tipado estricto, build web/Lambda, cinco raíces Terraform, ocho pruebas de
  planes mock de hosting, auditoría de producción y trazabilidad estructurada.
- 31 regresiones de scripts incluidas en la suite: aislamiento, referencias,
  fallos de preparación/subida/escritura/limpieza y señales.
- `terraform:validate`: ejecución real de Terraform, cinco raíces correctas;
  conserva avisos previos de deprecación del proveedor DynamoDB.
- `security`: sin vulnerabilidades en dependencias de producción.
- E2E local no ejecutado: no cambia un flujo de usuario ni un handler desplegado.
  Los checks remotos de la PR se registran en su seguimiento.

No se ha desplegado ni destruido AWS en esta entrega. Las regresiones con
proveedores/procesos simulados prueban propagación de errores, no IAM ni limpieza
real del sandbox. `sync:check` valida trazabilidad estática; no consulta GitHub,
no ejecuta pruebas y no verifica resultados remotos o veracidad semántica de la
prosa. Las referencias de evidencia histórica conservan sus propios límites.
Las garantías de borrado de productores tardíos son del contrato de aplicación
(#10/#89), no se acreditan por borrar fixtures en este smoke.

No cambian contratos públicos, claves de datos, IAM ni recursos/costes AWS.
