# Issue #15: plan propuesto para completar la demo permanente

## Estado

Plan aprobado por el usuario el 2026-10-03, incluidos los roles OIDC y el ciclo
AWS de despliegue, prueba y borrado, conservando el backend compartido. La
aprobación autoriza el trabajo; este documento no acredita su ejecución.

La PR #90 ya incorporó la alternativa HTTPS con el dominio predeterminado de
CloudFront. Su CI efímero pasó, incluida la destrucción; esto no acredita la
publicación de la demo permanente. #15 permanece abierta.

## Cambios propuestos

1. Añadir un control previo compartido para los workflows manuales. Admitir sólo
   `main`, el environment `demo` y los actores `anyulled`, `orLuzuriaga`,
   `raati5674` y `surinyach`. Comprobar tanto `github.actor` como
   `github.triggering_actor` antes de obtener credenciales. Las reejecuciones
   conservan esos controles. Configurar protección del environment para `main`.
2. Separar los roles OIDC de despliegue y destrucción de demo del rol efímero.
   Ambos usarán audience `sts.amazonaws.com` y subject exacto
   `repo:upc-malvaviscos/findly:environment:demo`. Permisos limitados a recursos
   demo, namespace `findly-demo`, región `eu-west-1` y su clave de estado.
   CloudFront requiere su tratamiento global. El rol de despliegue seguirá
   rechazando planes con borrados o reemplazos. El de borrado no podrá eliminar
   el bucket compartido de estado ni acceder a estados ajenos.
3. Ajustar `.github/workflows/deploy.yml` para aplicar esos controles, construir
   artefactos, publicar la SPA y comprobar HTTPS, API, Cognito y CORS en la
   dirección CloudFront real. Mantener intactos los controles de otros entornos.
   La demo permanecerá desplegada aunque falle su smoke.
4. Crear `.github/workflows/destroy-demo.yml`, exclusivamente manual. Exigir
   confirmación inequívoca de borrar la demo y sus datos; fijar cuenta, región,
   raíz y clave de estado mediante configuración revisada, sin inputs libres.
   Compartir concurrencia con el despliegue, sin cancelar runs activos.
5. Añadir un verificador de inventario y plan de destrucción: estado demo,
   nombres, etiquetas, ARN y propiedad deben concordar. Abortará ante un recurso
   compartido, de otro entorno o no identificado. No registrar estados,
   imágenes, tokens, contactos ni credenciales en logs o artefactos.
6. Detener productores antes de limpiar datos. Vaciar únicamente los buckets de
   la demo, incluidas versiones y delete markers, y eliminar sus colecciones
   Rekognition dinámicas. Conservar `allow_bucket_destroy=false`: el borrado
   explícito de datos ocurre fuera de `force_destroy`, seguido de la aplicación
   del plan de destrucción revisado. Comprobar multipart uploads y recuperación
   tras limpieza parcial antes de considerar el procedimiento terminado.
7. Verificar después del destroy que el estado demo esté vacío, que no queden
   recursos ni colecciones de la demo y que el backend compartido y los otros
   entornos permanezcan intactos. Mantener los roles operativos y el backend
   externos al stack de la demo para permitir una futura reconstrucción.

## Archivos y recursos

- Workflows de despliegue y nuevo borrado; scripts de autorización, inventario,
  limpieza y aceptación de demo, con pruebas de rechazo y recuperación.
- Configuración reproducible de roles OIDC demo y documentación de protección
  del environment. No reutilizar el trust amplio del módulo OIDC actual.
- Root `infra/environments/demo`, outputs de propiedad si son necesarios y
  validadores de Terraform. No modificar el CI efímero ni el bootstrap de estado.
- Nueva decisión ADR para roles y destrucción manual, aclaración de ADR-009,
  spec 14, runbooks y evidencia de #15 sincronizados.

## Validación

Primero: casos de actores permitidos/rechazados, reejecuciones, rama incorrecta,
confirmación ausente, recursos ajenos, planes inválidos y recuperación parcial;
actionlint, Terraform fmt/validate/tflint y gates completos del repositorio.

Después de autorización explícita del ciclo AWS: desplegar mediante GitHub OIDC,
verificar la SPA pública y los recorridos con datos exclusivamente sintéticos,
destruir por la acción manual y comprobar ausencia efectiva de recursos. Registrar
run y commit, resultados sanitizados e invariantes del backend y aislamiento.

Antes de cerrar #15: comprobar cada criterio de la issue y spec 14, completar
la evidencia desplegada, publicar la PR asociada, confirmar checks y merge
automático y sincronizar únicamente los criterios demostrados.

## Autorización

El plan modifica arquitectura y permisos y contempla una prueba que elimina
datos de demo. El usuario respondió «plan aprobado» a la solicitud de confirmar
implementación y ciclo AWS. Se ha cumplido la confirmación previa de `AGENTS.md`.
