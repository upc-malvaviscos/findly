# Auditoría de checklists de issues cerradas

Auditoría realizada contra el repositorio actual, las PRs fusionadas, pruebas y
evidencia existente. Una casilla se modificó sólo cuando había prueba objetiva.

| Issue | Criterios marcados                               | Criterios que permanecen sin marcar                                                             |
| ----- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| #3    | 3 de 3                                           | Ninguno. PR #27, tipos compartidos, Zod y pruebas actuales.                                     |
| #6    | Expiración de 300 s y SSE-S3                     | Rechazo real de firma/CORS: no hubo entorno desplegado.                                         |
| #8    | Matching >=95 % y ausencia de falsos Match       | DLQ tras tres reintentos: módulo no desplegado.                                                 |
| #10   | Borrado cubierto por pruebas y purgador unitario | Consulta posterior integrada de galería: no hay evidencia contra datos reales.                  |
| #12   | `fmt`, `validate` y `tflint`                     | `plan` sin costes fijos y privacidad/cifrado efectivos: no hay plan ni despliegue demostrativo. |

Las issues #6, #8, #10 y #12 contienen un comentario que describe el límite de
evidencia. Este registro no sustituye su checklist: GitHub sigue siendo la
fuente de verdad de estado y aceptación.
