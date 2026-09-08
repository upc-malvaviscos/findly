import type { RegistrationStatus } from './api';

export type EventEntity = {
  eventId: string;
  name: string;
  date: string;
  retentionDays: number;
  createdAt: string;
  // Spec 02/03 only confirm 'OPEN' as a filter value for GET /events; the
  // full lifecycle (draft/closed, etc.) is owned by spec 04 and undefined so far.
  status: string;
};

export type RegistrationEntity = {
  registrationId: string;
  eventId: string;
  email?: string;
  // Resolved spec 02 self-conflict ("consent" in the single-table column vs
  // "consentTimestamp" in the entity section) in favor of consentTimestamp.
  consentTimestamp: string;
  selfieS3Key: string;
  faceId?: string;
  status: RegistrationStatus;
  ttl: number;
};

export type PhotoEntity = {
  photoId: string;
  eventId: string;
  s3Key: string;
  uploadedAt: string;
  ttl: number;
};

export type MatchEntity = {
  matchId: string;
  eventId: string;
  registrationId: string;
  photoId: string;
  similarity: number;
  matchedAt: string;
  ttl: number;
};

export type GalleryTokenEntity = {
  tokenHash: string;
  registrationId: string;
  eventId: string;
  expiresAt: string;
  ttl: number;
};
