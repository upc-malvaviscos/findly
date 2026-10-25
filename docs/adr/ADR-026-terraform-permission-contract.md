# ADR-026: contrato Terraform/IAM y preflight de producción

Estado: implementación autorizada por el responsable el 2026-10-25 para
[#181](https://github.com/upc-malvaviscos/findly/issues/181). Aplicación IAM y
aceptación AWS independientes; este ADR no las autoriza ni acredita.

## Contexto

El run 40137794179 pasó el límite de cero eliminaciones y falló durante un
apply parcial. Las listas IAM de funciones/roles/colas habían divergido de
Terraform. Crear una función tampoco demostraba que su boundary permitiera
`BatchWriteItem` o consumir la cola de backfill. La comprobación de módulos
enumerados manualmente no descubría otro módulo fuera de esa lista.

## Decisión

Se conserva el generador IAM revisable y se contrasta con el grafo Terraform
de producción, sin otra lista manual de recursos. `permissions:check` se
integra en `verify` y en el job Terraform de CI; no se añade otro workflow ni
se alteran los checks obligatorios.

El lector copia fuentes y ZIP a un directorio temporal, sin backend, estados,
tfvars privados ni credenciales. Ejecuta sólo el proveedor AWS simulado. Un
plan da nombres/direcciones y permite derivar atributos calculados válidos
para la simulación. El estado JSON simulado posterior renderiza las políticas
inline y permite recorrer todos los recursos, incluidos los de correo opcional.
Un tipo de recurso sin contrato o un rol sin boundary/política provoca un fallo.

El contrato versiona operaciones por tipo de recurso y comprueba acciones,
recursos y condiciones. Incluye negativos de región, ownership, tags, PassRole
y función/cola del mapping. La boundary debe cubrir los patrones de recurso
completos con `*`/`?`, no sólo un ARN representativo. El evaluador local admite
un subconjunto explícito de políticas de identidad; rechaza lo no soportado.

`Deployment` incorpora el preflight entre plan y apply. Para valores aún
desconocidos genera una simulación fresca de las mismas fuentes y entradas
públicas revisadas; los valores conocidos del plan prevalecen. Para recursos
existentes usa ownership de `before`, nunca los tags solicitados en `after`.

Después lee por STS/IAM el rol de despliegue, sus políticas inline/administradas
paginadas, sus versiones predeterminadas y la boundary runtime aplicada.
Evalúa esos documentos leídos, no el generador presentado como IAM vigente.
También intersecta una eventual boundary del desplegador dentro del alcance
soportado. Un hueco o una lectura denegada impide el apply. El lector no muta IAM.
El generador prepara únicamente lecturas IAM de sí mismo y de las políticas
de su namespace para ese control; aplicarlas requiere otra operación autorizada.

## Límites y consecuencias

- Se comprueban las operaciones declaradas en el contrato, no todos los RPC
  posibles de una versión futura del proveedor. Tipos/entradas/condiciones
  nuevos necesitan revisión; no se omiten silenciosamente.
- No es AWS IAM Simulator ni aceptación funcional. No modela SCP, políticas de
  sesión, resource policies, disponibilidad, cuotas o entregabilidad. Una allow
  local no demuestra disponibilidad y no elimina cambios IAM entre lectura/apply.
- No se copian contactos a fixtures. Una suscripción de alertas con destinatario
  real requiere un caso de inventario revisado; falla sin mostrar la dirección.
- El control precede al apply del stack. Inicializar/planificar conserva las
  lecturas y operaciones de lockfile del backend S3.
- Se conservan no-deletion, OIDC, actores/rama y aislamiento de entornos. Los
  tags explícitos de mappings de fotos/correo expresan las condiciones ya
  exigidas por el generador. La política demo permanece sin ampliaciones.
- Administración/backfill, la boundary y las lecturas nuevas quedan preparados
  en código; no se aplican automáticamente. No se crea destrucción de producción
  ni se amplía recuperación #175 o sus destinatarios.

La [evidencia de #181](../evidence/issue-181-permission-preflight.md) separa
código, IAM aplicado y operación. Referencias de formato:
[Terraform JSON](https://developer.hashicorp.com/terraform/internals/machine-readable-ui)
y [proveedores simulados](https://developer.hashicorp.com/terraform/language/tests/mocking).
