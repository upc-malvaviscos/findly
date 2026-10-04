# 14 - Despliegue y destrucción manual de demo permanente mediante OIDC

## Objetivo

Publicar demo AWS persistente mediante una acción manual y destruirla mediante
otra acción manual independiente, sin interferir con CI efímero por PR.

## Implementación y aceptación — plan aprobado 2026-10-03

Los workflows `deploy.yml` y `destroy-demo.yml`, controles e inventario se
implementan con ADR-017. La configuración reproducible de roles independientes,
la preparación de identificadores exactos API/OAC y la recuperación de fallos
se documentan en `docs/runbooks/permanent-demo.md`. El environment `demo` ya
está limitado a `main`; roles y variables no secretas están configurados.
Evidencia: `docs/evidence/issue-15-permanent-demo.md`.

El run 37151100042, intento 3, acredita publicación y recorrido real de demo
con datos sintéticos. El borrado y la ausencia del inventario original se
verificaron en AWS. El run 37153651572 acredita recuperación/idempotencia
desde main con estado vacío; el verificador corregido se probó además contra
los 106 recursos originales mediante lecturas AWS. La entrega es PR #92.
La preparación
inicial de bindings sólo prepara API/web para autorizar sus IDs reales.

El inventario de destrucción incluye también el handler público `telemetry`
de ADR-018. `tests/infra/demo-controls.test.ts` contrasta los handlers declarados
por Terraform con el control de borrado y conserva el rechazo de claves
desconocidas. La aceptación AWS posterior a PR #93 se registra por separado en
la evidencia de issue #22; los planes y tests locales no acreditan el borrado.

## Estado y decisiones

Ampliación aprobada el 2026-10-03 de la issue #15 existente. Los workflows
deploy.yml y destroy-demo.yml implementan publicación y destrucción manual.
La demo publicada superó el smoke real y su borrado/ausencia/recuperación están
comprobados. Runs y limitaciones de cada prueba constan en la evidencia.
teardown-nonproduction.yml es un handoff con cron sin destrucción real.

Demo permanece hasta destrucción manual. La permanencia es de infraestructura,
no de datos: conservar caducidad/consentimiento/purga por evento.
La destrucción elimina todo el stack demo y sus datos; conserva el backend de
estado compartido y recursos externos/compartidos. No toca sandbox, producción,
PRs, certificados/DNS externos ni identidades SES compartidas.

## Alineación con AWS Well-Architected Framework

- **Seguridad**: OIDC, roles mínimos, autorización explícita antes de credenciales.
- **Fiabilidad**: estado bloqueado/cifrado y concurrencia común deploy/destroy.
- **Excelencia Operativa**: plan inspeccionable y evidencia reproducible.
- **Optimización de Costes**: serverless y presupuesto, sin destrucción programada.

## Autorización y configuración externa

Lista autorizada: anyulled, orLuzuriaga, raati5674 y surinyach. Verificar actores
antes de asumir el rol y en reejecuciones; definir controles sobre github.actor
y github.triggering_actor. Un colaborador con escritura fuera de la lista
no recibe credenciales ni modifica AWS. Proteger workflow/lista mediante revisión,
rama permitida y environment demo; no ejecutar código arbitrario de otra rama.

Configurar rol/trust OIDC por environment, restricciones GitHub, eu-west-1,
backend y buckets únicos. Demo admite el dominio HTTPS de CloudFront sin ACM
propio; con dominio propio, configurar DNS y ACM en us-east-1. Dominio y
remitente SES (spec 20) pendientes. No aceptar ARN, backend, cuenta o entorno
arbitrario en la acción de destrucción.

Referencia: [workflows manuales y permiso de escritura](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

## Workflow de despliegue

1. Validar actor/rama/environment/configuración antes de credenciales.
2. Construir Lambda y validar gates apropiados.
3. Inicializar infra/environments/demo, estado findly/demo/terraform.tfstate;
   revisar plan y aplicar exclusivamente el plan de ese run.
4. Compilar SPA en modo AWS con API/Cognito públicos, publicar dist/ en S3
   privado con CloudFront/OAC/HTTPS e invalidar caché. CORS usa el origen exacto
   publicado, también cuando AWS genera el dominio.
5. Probar demo publicada; no destruir al terminar ni ante un fallo del smoke.
   Registrar commit/run/resultados sin secretos.

## Workflow de destrucción

1. Acción separada solo workflow_dispatch, limitada a demo y la misma lista;
   sin schedule/PR triggers ni reutilizar dev:aws-destroy de sandbox.
2. Confirmación inequívoca de entorno/borrado de datos en inputs. Inventario y
   plan de destrucción con comprobación de cuenta, región, estado, tags y propiedad.
3. Concurrencia común con deploy, sin cancelación peligrosa, y bloqueo Terraform.
4. Detener productores/trabajos antes de limpiar datos; incluir objetos/versiones
   S3 y colecciones Rekognition dinámicas del namespace demo fuera del estado.
5. Resolver protección allow_bucket_destroy=false con diseño/ADR revisado;
   nunca habilitar destrucción general en demo/production ni quitar protección
   al backend compartido. Acordar roles de deploy/destroy y excepción manual a ADR-009.
6. Aplicar el plan de destrucción del run; verificar stack/colecciones ausentes,
   estado demo vacío y backend compartido intacto. Reintento recuperable.

## Dependencias y ausencia de solapamiento

- #11/#61: backend/aislamiento existentes; conservar evidencia.
- #22: smoke público/métricas; #18: runbook; #70: aceptación integral.
- Spec 15/#16: CI efímero independiente con teardown obligatorio por PR.
- Specs 20-23: aceptación de funciones nuevas cuando estén implementadas.

## Errores comunes a evitar

- Confundir frontend local o AWS efímero con demo publicada permanente.
- Destruir demo por cron/fin de CI o tocar backend/otros entornos.
- Confiar en la visibilidad del botón para autorizar colaboradores.
- Confundir permanencia del stack con datos sin caducidad.

## Criterios de aceptación y verificación

- [x] Dos acciones manuales identificables: deploy y destroy demo/datos.
- [x] Solo cuatro actores autorizados; rechazos y reejecuciones probados antes de AWS.
- [x] Rama/environment protegidos, trust OIDC acotado, sin claves estáticas.
- [x] SPA HTTPS publicada con backend real y sin destrucción automática.
- [x] Destroy exige confirmación e inventario/plan exacto de demo.
- [x] Stack/datos/colecciones demo limpios; backend y otros entornos intactos.
- [x] Concurrencia deploy/destroy y recuperación de fallos verificadas.
- [x] CI efímero mantiene aislamiento, permisos y teardown por PR.
- [x] AWS: deploy, recorrido demo y destroy sintéticos; ausencia de recursos
      comprobada además del éxito del workflow.
- [x] actionlint, Terraform fmt/validate/tflint y gates obligatorios en verde.
- [x] ADR, runbook y evidencia sincronizados con #15.

## Alternativa sin dominio aprobada (2026-10-03)

Solo demo permite dominio y certificado vacíos: usa HTTPS en el nombre generado
por CloudFront y certificado predeterminado AWS. AWS fija el mínimo TLSv1 de
este modo; no se afirma TLSv1.2_2021. Dominios propios conservan ACM/us-east-1
y TLSv1.2_2021; fuera de demo siguen siendo obligatorios. El ajuste no despliega
AWS ni completa los restantes criterios de #15.
