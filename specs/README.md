# Backlog de implementación

Los tickets son publicables como issues. Cada uno debe enlazar PR, prueba, evidencia en `docs/evidence/` y ADR cuando cambie una decisión. Orden: 00-03 fundación, 04-09 producto, 10-15 plataforma, 16-17 cierre y 18-19 evolución posterior.

| Dominio    | Responsable      | Tickets            |
| ---------- | ---------------- | ------------------ |
| Web        | Frontend         | 03, 04, 08, 18     |
| Backend    | Datos y matching | 02, 05, 06, 07, 09 |
| Plataforma | AWS y FinOps     | 10-15              |
| Calidad    | QA y memoria     | 00, 16, 17, 19     |

**Definición de terminado:** criterios de aceptación superados, pruebas automatizadas actualizadas, observabilidad, seguridad/FinOps y evidencia documental revisadas; la implementación, la spec y la issue GitHub deben indicar el mismo estado verificable.

## Ampliación de correo transaccional

- [20 - Email obligatorio y envío manual de galerías](20-gallery-email-notifications-with-ses.md): issue #86, ADR-019; implementado y desplegado según el responsable; configuración SES/DNS, nueve escenarios AWS y un buzón acreditados. #98 reabierta por evidencia pendiente del segundo proveedor.

## Backlog MVP ampliado (2026-10-03)

- [22 - Actualización manual, descarga y enlaces compartidos de galería](22-gallery-refresh-download-and-sharing.md): issue #88 cerrada e implementación presente. Sin bloqueadores por #49, también cerrada.

- [21 - Matching en ambos órdenes](21-matching-from-selfie-and-photo-uploads.md): #87 cerrada; backfill paginado best-effort, sin Outbox.
- [23 - Administración de eventos y fotografías](23-admin-event-and-photo-lifecycle.md): #89 cerrada; lotes, timeout y rutas acreditados. Barrera de #166 integrada por #168, con smoke AWS efímero y teardown; carreras/TTL específicos pendientes.
- [Instantánea de sincronización del 2026-10-23](../docs/evidence/2026-10-23-code-truth-sync.md): código, evidencia, límites y seguimiento vigente.
