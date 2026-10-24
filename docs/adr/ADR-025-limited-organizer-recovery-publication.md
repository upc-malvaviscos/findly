# ADR-025: publicación limitada de recuperación de organizadores

## Contexto y decisión aprobada — 2026-10-25

La PR #176 integró recuperación de acceso, pero el despliegue global de
producción 40137794179 aplicó cambios parciales y falló en recursos de
fotos/backfill. La web no llegó a publicarse. El responsable excluye reparar
esos recursos, ampliar IAM, repetir el despliegue global y lanzar AWS efímero.

El responsable aprueba un workflow manual específico, desde main y el
environment production, con el rol existente findly-production-deploy. Publica
una composición reproducible: frontend del último despliegue correcto,
`11c522923e937bfe5e97130de06217513052afde`, más los cinco archivos de
autenticación de `7218c3b268d02e11817a1a60ce86b049abdbf2ba` y sus dependencias
bloqueadas, incluida la actualización de Zod. No modifica el código de fotos ni
eventos de main. Esa funcionalidad posterior no forma parte de este artefacto.

La lista exacta está en scripts/lib/recovery-publication.mjs. Cada archivo
compuesto tiene hash SHA-256 en recovery-release.json, junto a ambos commits.
El build rechaza una deriva de dependencias o lockfile y comprueba tipos sobre
las fuentes compuestas. Sólo lee objetos Git: no copia overrides, credenciales,
estados ni contactos del checkout. AWS no se exporta al proceso Vite.

## Operación y límites

El workflow comparte la exclusión de deployment-production con Deployment.
Valida actores originales y de reejecución, main, cuenta, región y rol antes
de obtener OIDC. Lee el estado S3 en memoria, selecciona únicamente outputs
públicos y contrasta API, pool, cliente SPA y origen CloudFront desplegados.
No inicializa Terraform, no planifica ni aplica y no modifica IAM o Cognito.

El correo de galerías permanece habilitado en el build. Se prueban el primer
acceso y la confirmación de código contra dobles locales antes de publicar.
Los assets se suben antes del index; se conservan assets anteriores y una copia
del index previo en el artefacto del runner. Se invalida CloudFront y se
comprueban bytes, rutas y formulario real, sin autenticar ni enviar mensajes.
Antes de escribir, el bundle servido debe coincidir con el SHA-256 leído de
producción el 25 de octubre y vinculado al despliegue correcto, o con el nuevo
artefacto idéntico. Una versión ajena obliga a revisar la publicación; el
workflow no fija el nombre histórico de un asset ni revierte una web posterior.

Un fallo después de escribir S3 puede dejar una publicación parcial; no se
afirma rollback automático. Revisar la ejecución antes de reintentar. El index
previo permite una restauración explícita revisada, que no ejecuta este flujo.
Mantener assets anteriores permite servir páginas abiertas antes de publicar.

Esto no demuestra compatibilidad o salud integral del backend parcialmente
aplicado. Conserva el frontend anterior fuera de autenticación; no corrige los
problemas de fotos ni acredita recepción de correo, recuperación efectiva o
login posterior. No activa FINDLY_RECOVERY_ENABLED. La issue #175 permanece
abierta hasta completar su aceptación. Esta publicación es específica para
esta recuperación; una futura versión requiere revisar la composición fijada.

Referencias: [spec 04](../../specs/04-admin-event-management-and-cognito-authorization.md),
[issue #175](https://github.com/upc-malvaviscos/findly/issues/175),
[runbook](../runbooks/organizer-recovery.md) y
[evidencia](../evidence/organizer-recovery.md).
