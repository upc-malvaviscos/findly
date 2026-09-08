# Evidencia de contratos de dominio y claves DynamoDB

Implementación de la spec 02 (issue #3): DTOs de API compartidos, validadores
Zod, tipos de entidad DynamoDB y builders de claves de tabla única,
reutilizados por la web y las Lambdas. Incluye el ajuste del contrato de
inscripción pública (spec 03 / issue #4, ya fusionada) para eliminar la
deriva detectada frente al mock existente.

## Alcance verificado

- DTOs de API en `src/shared/types/api.ts` (`PublicEvent`, `EventsResponse`,
  `RegistrationRequest`, `RegistrationResponse`, `RegistrationStatus`,
  `RegistrationStatusResponse`, `ApiError`), reexportados sin duplicar por
  `src/web/types.ts`.
- `enrollmentFormSchema` centralizado en `src/shared/lib/validations.ts`
  (email opcional, `consentBiometrics` y `consentTerms` como literales
  independientes, mensajes de error en castellano), reexportado por
  `src/web/validation.ts`.
- Entidades DynamoDB tipadas en `src/shared/types/entities.ts` (`Event`,
  `Registration`, `Photo`, `Match`, `GalleryToken`). Se resuelve una
  discrepancia interna de la propia spec 02 entre la columna de tabla única
  (`consent`) y la sección de entidades (`consentTimestamp`) a favor de
  `consentTimestamp`; la spec se corrige en consecuencia.
- Builders de claves de tabla única en `src/shared/lib/dynamoKeys.ts`
  (`eventKey`, `registrationKey`, `photoKey`, `matchKey`, `galleryTokenKey`,
  `registrationPartitionKey`, `faceGsi1Key`, `toEpochSeconds`), cubiertos por
  10 pruebas unitarias.
- `src/lambdas/gallery.ts` refactorizado para consumir los builders de claves
  y los tipos de entidad en lugar de literales `PK`/`SK` y un tipo
  `GalleryItem` genérico. De paso corrige dos fugas de estrechamiento de
  tipos de TypeScript que el literal de plantilla (`` `PHOTO#${...}` ``)
  ocultaba.
- Contrato de inscripción pública alineado con la spec 02
  (`SelfieCaptureForm`, `ConsentCheckboxGroup`, `App.tsx`, `fixtures.ts`,
  `api.ts`): se elimina el campo `name` (no forma parte del contrato), el
  consentimiento se divide en dos casillas independientes,
  `Event.id` pasa a `eventId`, y `RegistrationStatusResponse.message` se
  sustituye por `failureReason?`; el copy de estado en curso/inscrito pasa a
  ser responsabilidad del frontend en lugar del backend simulado.
- Tests actualizados: `tests/web/enrollment.test.tsx`, `tests/web/App.test.tsx`
  y el flujo E2E `e2e/foundation.spec.ts` reflejan el nuevo formulario
  (sin nombre, dos casillas de consentimiento, email opcional).

## Pendiente

- `GalleryResponse`, `GalleryPhoto` y `ApiError` siguen duplicados entre
  `src/web/types.ts` y `src/lambdas/gallery.ts`; no se migran a
  `src/shared` en esta pasada (fuera del alcance acordado para esta issue).
- `EventEntity.status` se tipa como `string`: la spec 02/03 solo confirman
  el valor `'OPEN'`; el resto del ciclo de vida depende de decisiones aún
  no tomadas en la spec 04 (administración de eventos).
- Los DTOs de administración de eventos y del derecho al olvido (secciones
  4 y 5 de "Contratos DTO de API REST" en la spec 02) **no se implementan
  en esta issue**. Decisión explícita: se difieren a la issue #5
  (administración y Cognito) y a la issue #10 (consentimiento, retención y
  derecho al olvido), respectivamente, ya que hoy no existe ningún
  consumidor real de esos contratos. Ver la nota añadida directamente en
  `specs/02-domain-model-api-contracts-and-dynamodb-keys.md`.
- No se abre un ADR nuevo: se trata de una corrección de una inconsistencia
  interna de la propia spec 02, documentada y corregida directamente en ella.

## Validación

```text
npm run typecheck        PASS
npm run lint:code         PASS
npm run lint:markdown     PASS
npm run test              PASS (29 tests, 8 archivos)
npm run test:e2e          PASS (12 tests, chromium/firefox/webkit)
npm run build              PASS (web + lambdas + verificación de artefactos)
npm run terraform:format   PASS
npm run terraform:validate PASS
npm run security           PASS (0 vulnerabilidades en dependencias de producción)
npm run sync:check         PASS
npm run lint:format        FAIL (entorno local): CRLF por `core.autocrlf=true`
                            sin `.gitattributes`; afecta a los 54 archivos
                            del repositorio, incluidos los no tocados por
                            este cambio. Los blobs en Git ya están
                            normalizados a LF, por lo que se espera que pase
                            en CI (runners Linux). No corregido aquí por
                            quedar fuera del alcance de esta issue.
npm run lint:terraform     FAIL (entorno local): binario `tflint` no
                            instalado en el PATH de esta máquina. No se
                            modificó `infra/` en este cambio.
npm run lint:workflows     FAIL (entorno local): el glob `*.yml` del script
                            no se expande en la shell de Windows. No se
                            modificaron los workflows en este cambio.
```
