import { describe, expect, it } from 'vitest';
import {
  eventKey,
  faceGsi1Key,
  faceGsi1PartitionKey,
  galleryTokenKey,
  MATCH_SK_PREFIX,
  matchKey,
  parseRegistrationId,
  photoKey,
  registrationKey,
  registrationPartitionKey,
  toEpochSeconds,
} from '../../src/shared/lib/dynamoKeys';

describe('dynamoKeys', () => {
  it('builds the event key', () => {
    expect(eventKey('evt-1')).toEqual({ PK: 'EVENT#evt-1', SK: 'METADATA' });
  });

  it('builds the registration key', () => {
    expect(registrationKey('evt-1', 'reg-1')).toEqual({
      PK: 'EVENT#evt-1',
      SK: 'REG#reg-1',
    });
  });

  it('builds the photo key', () => {
    expect(photoKey('evt-1', 'photo-1')).toEqual({
      PK: 'EVENT#evt-1',
      SK: 'PHOTO#photo-1',
    });
  });

  it('builds the match key', () => {
    expect(matchKey('reg-1', 'photo-1')).toEqual({
      PK: 'REG#reg-1',
      SK: 'MATCH#photo-1',
    });
  });

  it('builds the gallery token key from a pre-hashed token', () => {
    expect(galleryTokenKey('abc123')).toEqual({
      PK: 'TOKEN#abc123',
      SK: 'METADATA',
    });
  });

  it('builds the registration partition key for the matches query', () => {
    expect(registrationPartitionKey('reg-1')).toBe('REG#reg-1');
  });

  it('matches key and partition key agree on the PK for the same registration', () => {
    expect(matchKey('reg-1', 'photo-1').PK).toBe(registrationPartitionKey('reg-1'));
    expect(matchKey('reg-1', 'photo-1').SK).toBe(`${MATCH_SK_PREFIX}photo-1`);
  });

  it('builds the GSI1 face-match key', () => {
    expect(faceGsi1Key('face-1', 'reg-1')).toEqual({
      GSI1PK: 'FACE#face-1',
      GSI1SK: 'REG#reg-1',
    });
  });

  it('builds the GSI1 partition key for querying by faceId alone', () => {
    expect(faceGsi1PartitionKey('face-1')).toBe('FACE#face-1');
  });

  it('faceGsi1Key and faceGsi1PartitionKey agree on GSI1PK for the same face', () => {
    expect(faceGsi1Key('face-1', 'reg-1').GSI1PK).toBe(
      faceGsi1PartitionKey('face-1'),
    );
  });

  it('parses the registrationId back out of a GSI1 sort key', () => {
    expect(parseRegistrationId('REG#reg-1')).toBe('reg-1');
  });

  it('round-trips faceGsi1Key.GSI1SK through parseRegistrationId', () => {
    expect(parseRegistrationId(faceGsi1Key('face-1', 'reg-1').GSI1SK)).toBe(
      'reg-1',
    );
  });

  it('returns null for a sort key without the REG# prefix', () => {
    expect(parseRegistrationId('MATCH#photo-1')).toBeNull();
    expect(parseRegistrationId('REG#')).toBeNull();
  });

  it('converts an offset to epoch seconds', () => {
    const from = new Date(5000);
    expect(toEpochSeconds(30, from)).toBe(35);
  });

  it('truncates sub-second milliseconds instead of rounding', () => {
    const from = new Date(1999);
    expect(toEpochSeconds(0, from)).toBe(1);
  });
});
