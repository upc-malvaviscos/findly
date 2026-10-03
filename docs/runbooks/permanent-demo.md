# Demo permanente: operación manual

## Configuración administrativa externa

El plan de #15 está aprobado. Antes de operar, proteger el environment `demo`
con una regla de deployment branch que sólo permita `main`. Sus variables son:

- `FINDLY_AWS_ACCOUNT_ID`: cuenta revisada.
- `AWS_TERRAFORM_STATE_BUCKET`: backend compartido existente
  `findly-terraform-state-<cuenta>`.
- `FINDLY_UPLOADS_BUCKET_NAME`: `findly-demo-uploads-<cuenta>-eu-west-1`.
- `FINDLY_WEB_BUCKET_NAME`: `findly-demo-web-<cuenta>-eu-west-1`.
- `AWS_DEPLOY_ROLE_ARN`: rol `findly-demo-deploy` en esa cuenta.
- `AWS_DESTROY_ROLE_ARN`: rol `findly-demo-destroy` en esa cuenta.

Dominio y certificado pueden quedar vacíos para usar HTTPS en CloudFront
(ADR-016). Si se configuran, conservar el par de variables de dominio/ACM.
No copiar credenciales AWS ni estados en variables o archivos del repositorio.

La persona administradora usa una sesión temporal ya autenticada. Generar los
documentos antes de aplicarlos y revisar sus límites:

```sh
FINDLY_AWS_ACCOUNT_ID=<cuenta> node scripts/configure-demo-roles.mjs --out-dir=<directorio-temporal>
FINDLY_AWS_ACCOUNT_ID=<cuenta> node scripts/configure-demo-roles.mjs --apply
```

El script reutiliza el proveedor OIDC existente y sólo modifica roles y políticas
operativos de demo cuya propiedad concuerde. No crea ni modifica el backend.
Véase ADR-017 para el alcance y la preparación de identificadores generados.

## Despliegue

1. Abrir **Deployment**, elegir `main`, entorno `demo` y `apply=true`.
2. Para una demo nueva o recreada, usar `prepare_demo_bindings=true`. Ese run
   prepara sólo API/web; no publica una demo completa.
3. Ejecutar de nuevo el configurador administrativo para enlazar los IDs reales
   de API/OAC en los roles, sin ampliar permisos a otros recursos.
4. Ejecutar **Deployment** con `prepare_demo_bindings=false` y `apply=true`.
   El workflow publica la SPA y prueba Cognito, creación de eventos, inscripción,
   subida y matching con una imagen sintética, y galería desde el navegador real.
5. Registrar el run y resultado. Un fallo deja la demo disponible para diagnóstico;
   nunca inicia automáticamente su destrucción.

Los usuarios sintéticos de aceptación se eliminan. Sus eventos mantienen la
retención por evento; la infraestructura persiste hasta un borrado manual.

## Destrucción y recuperación

1. Tras el despliegue completo, ejecutar de nuevo el configurador de roles para
   enlazar también los IDs exactos de distribución y pool. Esto permite las
   comprobaciones de ausencia cuando esos recursos ya no conservan etiquetas.
2. Abrir **Destroy permanent demo and its data** desde `main`.
3. Confirmar con `DELETE FINDLY DEMO AND ALL ITS DATA`.
4. El workflow comprueba autorización e inventario antes de limpiar. La demo
   queda fuera de servicio al revocar escrituras e invocaciones nuevas.
5. La espera de quiescencia depende del timeout máximo de las funciones: no
   cancelar el run mientras limpia o aplica la destrucción.
6. El workflow verifica ausencia efectiva y estado vacío, además del resultado
   Terraform. No interpretar un `AccessDenied` como recurso ausente.
7. Si falla, corregir la causa y repetir el mismo workflow. El inventario se
   vuelve a calcular sobre lo que quede; no habilitar `force_destroy` ni ejecutar
   comandos de sandbox. Hasta completar el borrado, no publicar datos nuevos.

Los dos workflows comparten concurrencia y el lock del estado. Los cuatro
actores autorizados se comprueban también en las reejecuciones. El backend y los
roles operativos permanecen para permitir el siguiente despliegue.

## Estado de aceptación

La publicación y recorrido real pasaron en el run 37151100042 (intento 3).
Destroy 37152095070 completó el borrado; el verificador corregido comprobó la
ausencia del inventario original y backend/estados ajenos intactos mediante
lecturas AWS. La integración y reejecución final se siguen en PR #92/#15.
Véase `docs/evidence/issue-15-permanent-demo.md` para pruebas y recuperación.
