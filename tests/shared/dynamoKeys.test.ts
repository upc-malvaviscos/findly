import { describe, expect, it } from 'vitest';
import {
  eventKey,
  faceGsi1Key,
  galleryTokenKey,
  MATCH_SK_PREFIX,
  matchKey,
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

  it('converts an offset to epoch seconds', () => {
    const from = new Date(5000);
    expect(toEpochSeconds(30, from)).toBe(35);
  });

  it('truncates sub-second milliseconds instead of rounding', () => {
    const from = new Date(1999);
    expect(toEpochSeconds(0, from)).toBe(1);
  });
});
