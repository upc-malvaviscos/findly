# 02 - Dominio, contratos de API y diseño DynamoDB Single-Table

## Objetivo

Establecer los contratos de datos compartidos entre frontend y backend (DTOs), esquemas Zod de validación y la arquitectura detallada de la tabla única (Single-Table Design) en Amazon DynamoDB sin ambigüedades.

## Alineación con AWS Well-Architected Framework

- **Eficiencia del Rendimiento**: Uso de Single-Table Design y GSI1 (`FACE#{faceId}`) para consultas O(1) de coincidencias sin realizar escaneos (`Scan`).
- **Optimización de Costes (FinOps)**: Modo `PAY_PER_REQUEST` (On-Demand) y purga automática mediante el atributo `ttl`.
- **Fiabilidad**: Habilitación de Point-In-Time Recovery (PITR) en entornos productivos.

## Modelo de Dominio de Datos

### Entidades Principales

- **Event**: `eventId`, `name`, `date`, `retentionDays`, `createdAt`, `status`, `cleanupAfter` (interno, opcional).
- **Registration**: `registrationId`, `eventId`, `email`, `consentTimestamp`, `selfieS3Key`, `faceId`, `tokenHash` (opcional para registros legacy), `status` (`UPLOAD_PENDING` | `PROCESSING` | `ENROLLED` | `FAILED`), `ttl`.
- **RetentionLocator**: `eventId`, `registrationId`, `tokenHash`, `collectionId`, `selfieS3Key`, `faceIds`, `uploadExpiresAt`, `cleanupAfter`, `cleanupState`, `erasureRequestedAt`, `cleanupCompletedAt`; campos de recuperación opcionales según estado, sin TTL (ADR-013).
- **Photo**: `photoId`, `eventId`, `s3Key`, `uploadedAt`, `ttl`.
- **Match**: `matchId`, `eventId`, `registrationId`, `photoId`, `similarity`, `matchedAt`, `ttl`.
- **GalleryToken**: `tokenHash` (SHA-256), `registrationId`, `eventId`, `expiresAt`, `ttl`.

## Arquitectura de Tabla Única DynamoDB (Single-Table Design)

Se aprovisiona una única tabla DynamoDB por entorno (`findly-{env}`) utilizando `PK` (Partition Key) y `SK` (Sort Key) de tipo String:

| Entidad          | Partition Key (`PK`)   | Sort Key (`SK`)        | Atributos Principales / GSIs                           |
| ---------------- | ---------------------- | ---------------------- | ------------------------------------------------------ |
| **Event**        | `EVENT#{eventId}`      | `METADATA`             | `name`, `date`, `retentionDays`, `createdAt`           |
| **Registration** | `EVENT#{eventId}`      | `REG#{registrationId}` | `email`, `consentTimestamp`, `faceId`, `status`, `ttl` |
| **Photo**        | `EVENT#{eventId}`      | `PHOTO#{photoId}`      | `s3Key`, `uploadedAt`, `ttl`                           |
| **Match**        | `REG#{registrationId}` | `MATCH#{photoId}`      | `eventId`, `similarity`, `matchedAt`, `ttl`            |
| **GalleryToken** | `TOKEN#{tokenHash}`    | `METADATA`             | `registrationId`, `eventId`, `expiresAt`, `ttl`        |

El locator usa `PK = EVENT#{eventId}` y `SK = RETENTION#{registrationId}`.
Conserva referencias sensibles de recuperación hasta la purga explícita;
DynamoDB TTL no puede eliminarlo antes de la limpieza externa.

### Índice Secundario Global (GSI1)

- `GSI1PK`: `FACE#{faceId}`
- `GSI1SK`: `REG#{registrationId}`

### Índice Secundario Global (GSI2) para eventos

- `GSI2PK`: `ENTITY#EVENT`
- `GSI2SK`: `{date}#{eventId}`
- Permite `GET /admin/events` con `Query`, ordenado por fecha y sin `Scan`.

## Contratos DTO de API REST (TypeScript / Zod)

### 1. Registro Público (`POST /events/{eventId}/registrations`)

- **Request Body**: `{ email?: string; consentBiometrics: true; consentTerms: true; }`
- **Response (201 Created)**: `{ registrationId: string; galleryToken: string; uploadUrl: string; expiresInSeconds: number; }`

### 0. Descubrimiento de eventos públicos (`GET /events`)

- Devuelve únicamente eventos con `status = 'OPEN'`: `{ events: Array<{ eventId: string; name: string; date: string; }> }`.
- El selector de evento usa esta respuesta cuando no recibe `?event={eventId}`.

### 2. Estado de Registro (`GET /registrations/{registrationId}/status`)

- Requiere `X-Gallery-Token`; el registro TOKEN resuelve eventId sin Scan ni nuevo índice (ADR-011).

- **Response (200 OK)**: `{ registrationId: string; status: 'UPLOAD_PENDING' | 'PROCESSING' | 'ENROLLED' | 'FAILED'; failureReason?: string; }`

### 2b. Telemetría de errores de inscripción (`POST /telemetry/enrollment-errors`)

- Pública y con throttling propio en el stage. Request:
  `{ stage: 'registration' | 'upload' | 'polling'; code: ClientEnrollmentErrorCode; }`.
  Los enums y su normalización se definen en
  `src/shared/lib/enrollmentErrorTelemetry.ts` (ADR-018).
- **Response (204 No Content)**. Cualquier campo adicional, valor desconocido
  o cuerpo de más de 256 bytes devuelve `400 INVALID_REQUEST` y no se registra.

### 3. Galería Privada (`GET /gallery?token={token}`)

- **Response (200 OK)**: `{ eventId: string; eventName: string; registrationId: string; photos: Array<{ photoId: string; url: string; matchedAt: string; }>; expiresAt: string; }`

> **Corrección de contrato (issue #10):** se añade `registrationId` a la
> respuesta, ausente en la versión original de esta spec. Sin él, el
> cliente no tenía forma de construir
> `DELETE /registrations/{registrationId}` (sección 5) a partir de lo que
> devuelve esta llamada — solo dispone del token opaco. `registrationId`
> es un identificador opaco y pseudónimo que se trata como dato sensible;
> conocerlo no permite consultar ni borrar sin el token autorizado.

### 4. Administración de eventos (JWT de Cognito obligatorio)

- `GET /admin/events`: lista eventos administrables.
- `POST /admin/events`: crea un evento con `{ name: string; date: string; retentionDays: number; }` y devuelve `201` con el `eventId`.
- `POST /admin/events/{eventId}/photos/uploads`: recibe `{ files: Array<{ fileName: string; contentType: 'image/jpeg'; }> }` y devuelve una URL `PUT` prefirmada y `photoId` por archivo. Solo acepta JWT válido y eventos abiertos y vigentes; devuelve `410 EVENT_EXPIRED` si han cerrado o caducado.

> **Implementado (issue #5):** `src/shared/types/api.ts` y
> `src/shared/lib/validations.ts` publican los DTOs y validadores de
> administración. `GET /admin/events` usa `Query` sobre GSI2, `POST
/admin/events` devuelve `201 { eventId }`, y la ruta de subidas devuelve
> `{ uploads }` con un `photoId`, URL `PUT` y expiración de 300 segundos por
> JPEG. Los errores conservan el contrato común sin datos sensibles.

### 5. Derecho al olvido (`DELETE /registrations/{registrationId}`)

- Requiere la cabecera `X-Gallery-Token` con el token opaco de la galería. El backend calcula su SHA-256 y solo continúa si pertenece al `registrationId` solicitado.
- La respuesta es `204 No Content`. El token nunca se escribe en logs, trazas o mensajes de error.

> **Implementado (issue #10):** `src/lambdas/deleteRegistration.ts`. Sin DTO
> de petición (solo path param + cabecera); sin cuerpo de respuesta. La ruta
> `GET /gallery` de issue #9 ya está conectada al HTTP API; la integración
> gestionada de borrado se incorpora en PR #71; su aceptación AWS sigue pendiente.

### Errores comunes de API

Todas las respuestas de error usan `{ code: string; message: string; requestId: string; }` sin PII ni tokens. Los códigos mínimos son: `400 INVALID_REQUEST`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 EVENT_NOT_FOUND | REGISTRATION_NOT_FOUND | GALLERY_NOT_FOUND`, `409 INVALID_REGISTRATION_STATE` y `410 GALLERY_EXPIRED`.

## Guía de Implementación Paso a Paso para el Ingeniero Junior

### Paso 1: Crear los DTOs en el Paquete Compartido

- En `@/types/api.ts`, exporta todas las interfaces TypeScript de las peticiones y respuestas HTTP.

### Paso 2: Crear Validadores Zod

- Define los objetos Zod correspondientes en `@/lib/validations.ts` para que puedan ser reutilizados tanto en la web React como en las funciones Lambda.

### Paso 3: Probar la Normalización y Serialización

- Escribe una prueba unitaria en Vitest que valide que Zod rechaza payloads mal formados o tipos incorrectos.

## Errores Comunes a Evitar (Pitfalls)

- ❌ **ERROR**: Guardar el token de galería en texto claro en DynamoDB.
  - _Solución_: Calcula siempre el hash SHA-256 (`crypto.createHash('sha256').update(token).digest('hex')`) antes de buscar o guardar en la clave `TOKEN#{tokenHash}`.
- ❌ **ERROR**: Olvidar convertir la fecha de caducidad `ttl` a segundos Epoch en UNIX.
  - _Solución_: DynamoDB exige segundos (`Math.floor(Date.now() / 1000) + offsetSeconds`), no milisegundos.

## Lista de Verificación Pre-PR (Junior Checklist)

- [x] Todas las entidades DTOs tienen sus tipos TypeScript exportados.
      _(Administración entregada después en #5; DELETE no tiene body/DTO.
      La entrega de tipos no acredita todos los endpoints públicos de #22.)_
- [x] Los esquemas Zod validan correctamente los datos en cliente y servidor.
- [x] Ningún token en claro ni dato biométrico vectorial se persiste sin cifrar o anonimizar.

## Contrato público actualizado (issue #70)

La inscripción devuelve `galleryToken` opaco y polling requiere
`X-Gallery-Token`; véase ADR-011. Sólo el hash se persiste y la SPA entrega el
enlace de galería al finalizar la inscripción. Esta implementación no añade
entrega de correo. La verificación AWS efímera sigue siendo una evidencia
independiente de los tests unitarios.

## Selfies inmutables y recuperación (issue #70)

Las selfies usan PUT firmado `If-None-Match: *`, con vigencia máxima de 300
segundos acotada por la caducidad del evento. REG, TOKEN y locator RETENTION
sin TTL se crean en una única transacción. El locator conserva IDs faciales
conocidos; ListFaces paginado recupera la ventana IndexFaces → persistencia.
Polling no devuelve estado de inscripciones marcadas para borrado.
Véanse ADR-013, ADR-014 y ADR-015; los tests del SDK no sustituyen la verificación S3 403/412.
