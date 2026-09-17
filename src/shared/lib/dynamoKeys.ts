export type PrimaryKey = { PK: string; SK: string };
export type Gsi1Key = { GSI1PK: string; GSI1SK: string };
export type Gsi2Key = { GSI2PK: string; GSI2SK: string };

export const EVENT_LISTING_GSI2_PARTITION_KEY = 'ENTITY#EVENT';

export function eventKey(eventId: string): PrimaryKey {
  return { PK: `EVENT#${eventId}`, SK: 'METADATA' };
}

export function eventListingGsi2Key(date: string, eventId: string): Gsi2Key {
  return {
    GSI2PK: EVENT_LISTING_GSI2_PARTITION_KEY,
    GSI2SK: `${date}#${eventId}`,
  };
}

export function registrationKey(
  eventId: string,
  registrationId: string,
): PrimaryKey {
  return { PK: `EVENT#${eventId}`, SK: `REG#${registrationId}` };
}

export function photoKey(eventId: string, photoId: string): PrimaryKey {
  return { PK: `EVENT#${eventId}`, SK: `PHOTO#${photoId}` };
}

export function matchKey(registrationId: string, photoId: string): PrimaryKey {
  return { PK: `REG#${registrationId}`, SK: `MATCH#${photoId}` };
}

export const MATCH_SK_PREFIX = 'MATCH#';

export function registrationPartitionKey(registrationId: string): string {
  return `REG#${registrationId}`;
}

export function galleryTokenKey(tokenHash: string): PrimaryKey {
  return { PK: `TOKEN#${tokenHash}`, SK: 'METADATA' };
}

export function faceGsi1Key(faceId: string, registrationId: string): Gsi1Key {
  return { GSI1PK: `FACE#${faceId}`, GSI1SK: `REG#${registrationId}` };
}

export function faceGsi1PartitionKey(faceId: string): string {
  return `FACE#${faceId}`;
}

const REGISTRATION_SORT_KEY_PREFIX = 'REG#';

export function parseRegistrationId(gsi1SortKey: string): string | null {
  if (!gsi1SortKey.startsWith(REGISTRATION_SORT_KEY_PREFIX)) return null;
  const registrationId = gsi1SortKey.slice(REGISTRATION_SORT_KEY_PREFIX.length);
  return registrationId === '' ? null : registrationId;
}

export function toEpochSeconds(
  offsetSeconds: number,
  from = new Date(),
): number {
  return Math.floor(from.getTime() / 1000) + offsetSeconds;
}
