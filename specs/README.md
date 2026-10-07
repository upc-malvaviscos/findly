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

- [20 - Email obligatorio y envío manual de galerías](20-gallery-email-notifications-with-ses.md): issue #86, ADR-019; código y pruebas locales, configuración SES/DNS y aceptación AWS pendientes.

## Backlog MVP ampliado (2026-10-03)

- [22 - Actualización manual, descarga y enlaces compartidos de galería](22-gallery-refresh-download-and-sharing.md): issue #88; pendiente de implementación. Sin bloqueadores por #49.
