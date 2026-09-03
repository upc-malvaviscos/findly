# 02 - Dominio, contratos de API y diseño DynamoDB Single-Table

## Objetivo
Establecer los contratos de datos compartidos entre frontend y backend (DTOs), esquemas Zod de validación y el diseño de la tabla única (Single-Table Design) en DynamoDB sin ambigüedades.

## Modelo de Dominio de Datos

### Entidades Principales
- **Event**: `eventId`, `name`, `date`, `retentionDays`, `createdAt`, `status`.
- **Registration**: `registrationId`, `eventId`, `email`, `consentTimestamp`, `selfieS3Key`, `faceId`, `status` (`UPLOAD_PENDING` | `PROCESSING` | `ENROLLED` | `FAILED`), `ttl`.
- **Photo**: `photoId`, `eventId`, `s3Key`, `uploadedAt`, `ttl`.
- **Match**: `matchId`, `eventId`, `registrationId`, `photoId`, `similarity`, `matchedAt`, `ttl`.
- **GalleryToken**: `tokenHash` (SHA-256), `registrationId`, `eventId`, `expiresAt`, `ttl`.

## Patrones de Claves DynamoDB (Single-Table Design)

Se adopta una única tabla DynamoDB por entorno (`findly-{env}`) utilizando `PK` (Partition Key) y `SK` (Sort Key) de tipo String:

| Entidad | Partition Key (`PK`) | Sort Key (`SK`) | Atributos Principales / GSIs |
| --- | --- | --- | --- |
| **Event** | `EVENT#{eventId}` | `METADATA` | `name`, `date`, `retentionDays`, `createdAt` |
| **Registration** | `EVENT#{eventId}` | `REG#{registrationId}` | `email`, `consent`, `faceId`, `status`, `ttl` |
| **Photo** | `EVENT#{eventId}` | `PHOTO#{photoId}` | `s3Key`, `uploadedAt`, `ttl` |
| **Match** | `REG#{registrationId}` | `MATCH#{photoId}` | `eventId`, `similarity`, `matchedAt`, `ttl` |
| **GalleryToken** | `TOKEN#{tokenHash}` | `METADATA` | `registrationId`, `eventId`, `expiresAt`, `ttl` |

- **GSI1 (Búsqueda por FaceID)**: `GSI1PK = FACE#{faceId}`, `GSI1SK = REG#{registrationId}`.

## Contratos DTO de API REST (TypeScript / Zod)

### 1. Registro Público (`POST /events/{eventId}/registrations`)
- **Request Body**:
```typescript
{
  email?: string;
  consentBiometrics: true;
  consentTerms: true;
}
```
- **Response (201 Created)**:
```typescript
{
  registrationId: string;
  uploadUrl: string; // URL PUT prefirmada S3 (válida 5 min)
  expiresInSeconds: number;
}
```

### 2. Estado de Registro (`GET /registrations/{registrationId}/status`)
- **Response (200 OK)**:
```typescript
{
  registrationId: string;
  status: 'UPLOAD_PENDING' | 'PROCESSING' | 'ENROLLED' | 'FAILED';
  failureReason?: string;
}
```

### 3. Galería Privada (`GET /gallery?token={token}`)
- **Response (200 OK)**:
```typescript
{
  eventId: string;
  eventName: string;
  photos: Array<{
    photoId: string;
    url: string; // URL GET prefirmada S3 (válida 5 min)
    matchedAt: string;
  }>;
  expiresAt: string;
}
```

### 4. Subida Masiva Admin (`POST /events/{eventId}/photos/upload-url`)
- **Header**: `Authorization: Bearer <Cognito_JWT>`
- **Request Body**: `{ fileNames: string[] }`
- **Response (200 OK)**:
```typescript
{
  uploads: Array<{
    fileName: string;
    photoId: string;
    uploadUrl: string;
  }>;
}
```

## Criterios de Aceptación
- Todos los DTOs y tipos están exportados en un paquete o archivo compartido (`@/types/api.ts`).
- Las pruebas unitarias validan la serialización/deserialización Zod en cliente y Lambdas.
- No se exponen tokens de galería ni FaceIds en claro en la API pública ni en logs.
