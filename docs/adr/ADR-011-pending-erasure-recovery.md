# ADR-011: Recuperación de borrados pendientes

> Documento histórico de la rama anterior a su alineación (2026-09-29).
> Sus decisiones y resultados describen aquella versión, no el contrato vigente.
> Se adopta la implementación de main y sus ADR-011 a ADR-015; véase
> [la evidencia de alineación](../evidence/issue-07-main-alignment.md).

## Estado

APLAZADO por decisión de la persona responsable: no ampliar por ahora la
recuperación automática ni modificar PhotoMatcher. No implementado.
No autoriza despliegues ni operaciones en AWS.

## Problema

ADR-003 exige TTL en todas las entidades. ADR-010 conserva las referencias de
borrado sólo mientras sobrevivan inscripción y token. Si una dependencia falla
y esas referencias caducan, el cliente no puede completar la limpieza. Además,
una URL PUT aún vigente puede recrear una selfie después del borrado.

## Propuesta para aprobación

Introducir una orden interna de limpieza en la misma tabla, registrada de
forma atómica con la revocación de la inscripción. Conservar únicamente los
identificadores necesarios para localizar los recursos, el hash del token
cuando sea necesario y los tiempos de coordinación; nunca email, imagen,
embedding ni token en claro. No amplía la autorización del usuario ni el
plazo de validez de su galería.

La orden pendiente no tendrá TTL: se eliminará explícitamente al completar
la limpieza y su comprobación final. Esta excepción a ADR-003 impide que
DynamoDB borre el trabajo pendiente durante una avería; también implica que
los identificadores podrían conservarse más allá de la retención ordinaria
si el fallo persiste. Se necesitan métricas de pendientes/fallos y un
procedimiento de intervención, sin incluir identificadores en logs.

Reutilizar RetentionPurger y su programación diaria. La limpieza interactiva
seguirá intentándose inmediatamente; el proceso programado recuperará las
operaciones abandonadas sin depender del token. La recuperación automática
puede demorarse hasta la siguiente ejecución diaria, o más si hay fallos.
No se añaden colas, tablas ni servicios de coste fijo. El módulo de purga
todavía necesita conexión al stack, en una entrega de infraestructura posterior.

Las subidas tardías se tratarán al recibir sus eventos S3: una inscripción
revocada, ausente o vencida no se indexará y se limpiará su objeto. Se conservará
la orden para una comprobación posterior a la ventana de subida. Esperar 300
segundos por sí solo no acredita que una transferencia iniciada antes de
caducar la URL haya terminado; las pruebas deben contemplar eventos tardíos.

## Alternativa

Mantener TTL también en la orden y usar una ventana de reintentos acotada.
Conserva la regla actual de retención, pero no soluciona la pérdida de trabajo
si la avería dura más que esa ventana. No se presentaría como recuperación
garantizada de borrados pendientes.

## Plan de implementación si se aprueba

1. Añadir contrato y clave de orden de limpieza; extraer la limpieza común de
   deleteRegistration y registrar la revocación/orden de forma atómica.
2. Reutilizarla desde RetentionPurger con paginación, errores por operación y
   reintentos idempotentes; conservar las órdenes que no se completen.
3. Coordinar SelfieIndexer con las órdenes y limpiar subidas tardías. Revisar
   la escritura de coincidencias para que no repueble una inscripción revocada.
4. Probar con unitarias y Floci: fallo de dependencia, pérdida de registro/token
   por TTL, ausencia del usuario, subidas tardías, concurrencia, paginación y
   fallo parcial sin perder la orden. Rekognition seguirá simulado.
5. Actualizar permisos mínimos del módulo afectado y validar Terraform sin
   desplegar. Sincronizar specs 02, 06 y 09, ADR-003/010, memoria y evidencia.

Los cambios de contrato público se limitarán a los estrictamente necesarios
y deberán quedar explícitos. No se afirmará una garantía AWS a partir de
pruebas con mocks o emulador.

## Referencias

- [ADR-003](ADR-003-authorized-biometric-data-retention.md).
- [ADR-010](ADR-010-selfie-enrollment-boundaries.md).
- [Spec 09](../../specs/09-consent-audit-data-retention-and-right-to-erasure.md).
- [Límites de la tercera entrega](../evidence/issue-07-conditional-upload-erasure.md).
