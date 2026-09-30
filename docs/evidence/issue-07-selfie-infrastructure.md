# Issue #7: infraestructura de inscripción sin despliegue

> Documento histórico de la rama anterior a su alineación (2026-09-29).
> Sus decisiones y resultados describen aquella versión, no el contrato vigente.
> Se adopta la implementación de main y sus ADR-011 a ADR-015; véase
> [la evidencia de alineación](issue-07-main-alignment.md).

## Alcance y decisiones

Base: `d605585`. Rama: `feature/issue-7-selfie-enrollment-rekognition`.
La rama aún no existe en origin; `git pull --rebase origin main` confirmó
que estaba actualizada. Se conserva ADR-011 como propuesta aplazada por
decisión explícita: no implementar recuperación automática ni cambiar
PhotoMatcher. No se amplía la retención de órdenes de borrado.

Se añade `infra/modules/selfie-enrollment`, conectado a `findly-stack` y por
tanto a sandbox, demo y production. Declara:

- Bucket separado por proyecto, entorno, cuenta y región, reutilizando el
  módulo privado existente: bloqueo público, SSE-S3, CORS y PUT condicional.
- SelfieIndexer Node.js 22, 512 MB, 10 s y ZIP compilado para Node 22.
- Variables TABLE_NAME, FINDLY_SELFIE_BUCKET y REKOGNITION_COLLECTION_PREFIX.
- Rol dedicado con GetObject sólo para selfies, GetItem/UpdateItem de la
  tabla, CreateCollection/IndexFaces/DeleteFaces en el prefijo del proyecto
  y la cuenta/región concretas, y escritura en su propio grupo de logs.
- Notificación ObjectCreated:Put con events/ y .jpg, permiso de invocación
  limitado al bucket y cuenta, y dependencia explícita antes de configurar S3.
- Dos reintentos de errores de función, edad máxima de evento 21600 s
  (valores predeterminados AWS declarados), logs de 14 días y alarma Errors
  dirigida al topic existente. No añade una cola de recuperación ni garantiza
  procesamiento tras agotar los reintentos.

Los outputs del stack y de sus raíces publican el bucket y la función. El
bucket de fotos y su circuito SQS no cambian. En photo-matching/main.tf sólo
se sustituye un comentario obsoleto; no se modifica ningún handler.
El root ephemeral sigue con su alcance actual de API/admin/galería y no se
le añade el indexador. No se migra ningún objeto existente.

## Verificación local

```sh
npm run test:infra:selfie
```

Compila el artefacto, inicializa el proveedor y ejecuta cuatro pruebas con
`mock_provider "aws"`, `override_during = plan` y `command = plan` en todos
los casos. No requiere credenciales ni realiza operaciones contra AWS.
Las cuatro pasan: bucket privado, contrato Lambda, notificación y permisos.
El job Terraform de CI incorpora ese comando; no se ejecutó el workflow remoto.

| Comando                                        | Resultado                                                   |
| ---------------------------------------------- | ----------------------------------------------------------- |
| npm run test:infra:selfie                      | 4 pruebas Terraform pasan                                   |
| npm run test                                   | 254 pruebas pasan en 26 archivos                            |
| npm run build                                  | Pasa, siete ZIP verificados; avisos Rollup de Zod sin fallo |
| npm run typecheck                              | Pasa                                                        |
| npm run lint:workflows                         | Pasa                                                        |
| terraform -chdir=infra fmt -check -recursive   | Pasa                                                        |
| npm run terraform:validate con proveedor local | Pasan las cinco raíces                                      |
| TFLint desde WSL                               | Pasan las cinco raíces y el módulo nuevo                    |

`npm run verify` completo pasa en WSL (2026-09-28), con código de salida 0:
lint (incluido TFLint y actionlint), typecheck, 254 pruebas en 26 archivos,
build, formato y validación de las cinco raíces Terraform, security y
sync:check. La auditoría de producción (`npm audit --omit=dev`) encuentra
cero vulnerabilidades. La instalación completa avisó de cinco vulnerabilidades
en dependencias de desarrollo; no se modificaron las dependencias.
`sync:check` no comprueba el estado remoto de GitHub.

Se utilizó una copia aislada del contenido actual, incluidos archivos nuevos y
cambios sin commit, con el índice Git original para comprobar archivos seguidos.
No se sustituyó node_modules de Windows. Entorno: Node 24.21.0 mediante NVM,
npm 11.19.0, Terraform 1.16.4 y TFLint 0.64.0. Tras `npm ci`, se añadió
`/snap/bin` al PATH y se facilitó zip 3.0 desde el paquete de Ubuntu en una
carpeta aislada. `npm run harness:check` también pasa. La copia reside bajo
el home de WSL porque TFLint instalado mediante Snap no ve la copia en /tmp.
El intento anterior en Windows seguía bloqueado por TFLint ausente de su PATH;
la ejecución completa en WSL resuelve esa limitación de verificación.

La descarga inicial del proveedor falló por timeout TLS. Se reutilizó el
proveedor 5.100.0 ya instalado; posteriormente el comando de pruebas también
completó init con verificación firmada por HashiCorp. Se incorpora su checksum
Windows en los lockfiles existentes, sin cambiar versión ni retirar los hashes
Linux o del registro. El módulo nuevo conserva un lockfile para sus pruebas.
Para repetir la validación sin descargar nuevamente, una vez instalado:

```powershell
$taskProviderPath=(Resolve-Path 'infra/modules/selfie-enrollment/.terraform/providers').Path.Replace('\','/')
$env:TF_CLI_ARGS_init='-plugin-dir="' + $taskProviderPath + '"'
npm run terraform:validate
Remove-Item Env:TF_CLI_ARGS_init
```

No se vuelven a ejecutar Floci/E2E: no cambia el código ejecutable ni el flujo
web. La evidencia anterior acredita 12 pruebas Floci con Rekognition simulado
y 12 E2E HTTP simulado; no demuestra esta notificación automática en AWS.

## Pendientes y límites

- Por instrucción expresa, no se ejecutan apply, despliegues, smoke AWS,
  dev:aws, creación de PR ni push que pudieran activar despliegues del repo.
- Los tests de plan verifican configuración, no entrega S3, reconocimiento
  facial, enforcement de IAM/CORS ni respuesta real de los servicios.
- El presigner público y las rutas de inscripción/estado siguen pendientes;
  la UI todavía no completa inscripción real. El bucket nuevo se publica
  como output para su futura conexión. El borrador y purgador tampoco quedan
  conectados automáticamente a ambos buckets por esta entrega.
- Persisten los límites de TTL, subidas tardías y carreras de borrado/matching
  documentados en ADR-010/011; la persona responsable aplazó su ampliación.
- La issue #7 no se cierra con estas pruebas locales. No hay GitHub CLI ni
  conector de issues disponible: queda pendiente publicar un comentario con
  esta evidencia, alcance y límites. No hay PR de esta entrega.

Se sincronizan spec 06, ADR-010/011, estrategia de pruebas y memoria. No se
presentan recursos declarados como desplegados ni propuesta aplazada como
requisito implementado.

## Referencias técnicas

- [Terraform: proveedor simulado](https://developer.hashicorp.com/terraform/language/tests/mocking).
- [Lambda: configuración de reintentos asíncronos](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-configuring.html).
