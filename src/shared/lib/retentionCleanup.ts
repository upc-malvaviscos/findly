import type { PrimaryKey } from './dynamoKeys';

// No ttl: this is the durable cleanup locator, not a user-facing record.
export type RetentionLocatorEntity = {
  PK: string;
  SK: string;
  eventId: string;
  registrationId: string;
  tokenHash?: string;
  collectionId?: string;
  selfieS3Key: string;
  faceIds?: Set<string>;
  uploadExpiresAt?: number;
  cleanupAfter?: number;
  cleanupState?: 'ACTIVE' | 'DELETING' | 'CLEANED';
  erasureRequestedAt?: string;
  cleanupCompletedAt?: string;
};

export function retentionLocatorKey(
  eventId: string,
  registrationId: string,
): PrimaryKey {
  return { PK: `EVENT#${eventId}`, SK: `RETENTION#${registrationId}` };
}

export function isRetentionLocator(
  item: Record<string, unknown> | undefined,
): item is RetentionLocatorEntity {
  return Boolean(
    item &&
    typeof item.eventId === 'string' &&
    typeof item.registrationId === 'string' &&
    item.PK === `EVENT#${item.eventId}` &&
    item.SK === `RETENTION#${item.registrationId}` &&
    typeof item.selfieS3Key === 'string',
  );
}

// Matches the explicitly configured six-hour maximum age of async S3 events
// plus one SelfieIndexer timeout. Expiry alone does not revoke issued PUTs.
export function cleanupDeadline(
  uploadExpiresAt: number | undefined,
  now = Math.floor(Date.now() / 1000),
): number {
  return Math.max(uploadExpiresAt ?? now + 300, now) + 6 * 60 * 60 + 10;
}

export function localCleanupWithoutBiometrics(
  endpoint: string | undefined,
  faceCount: number,
): boolean {
  if (
    !endpoint ||
    faceCount !== 0 ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.FINDLY_LOCAL_NO_BIOMETRICS !== '1'
  )
    return false;
  try {
    return ['localhost', '127.0.0.1', 'floci'].includes(
      new URL(endpoint).hostname,
    );
  } catch {
    return false;
  }
}
