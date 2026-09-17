import { describe, expect, it } from 'vitest';
import {
  eventPhotoObjectKey,
  parseEventPhotoObjectKey,
  selfieObjectKey,
} from '../../src/shared/lib/s3Keys';

describe('s3Keys', () => {
  it('builds the deterministic selfie object key', () => {
    expect(selfieObjectKey('evt-1', 'reg-1')).toBe(
      'events/evt-1/selfies/reg-1.jpg',
    );
  });

  it('builds the deterministic event photo object key', () => {
    expect(eventPhotoObjectKey('evt-1', 'photo-1')).toBe(
      'events/evt-1/photos/photo-1.jpg',
    );
  });

  it('parses eventId and photoId back out of an event photo key', () => {
    expect(parseEventPhotoObjectKey('events/evt-1/photos/photo-1.jpg')).toEqual(
      {
        eventId: 'evt-1',
        photoId: 'photo-1',
      },
    );
  });

  it('round-trips through the builder and the parser', () => {
    const key = eventPhotoObjectKey('evt-42', 'photo-99');
    expect(parseEventPhotoObjectKey(key)).toEqual({
      eventId: 'evt-42',
      photoId: 'photo-99',
    });
  });

  it('returns null for a selfie key, since it is not an event photo key', () => {
    expect(
      parseEventPhotoObjectKey('events/evt-1/selfies/reg-1.jpg'),
    ).toBeNull();
  });

  it('returns null for a malformed or unrelated key', () => {
    expect(parseEventPhotoObjectKey('not-a-findly-key.jpg')).toBeNull();
    expect(
      parseEventPhotoObjectKey('events/evt-1/photos/photo-1.png'),
    ).toBeNull();
    expect(
      parseEventPhotoObjectKey('events/evt-1/photos/nested/photo-1.jpg'),
    ).toBeNull();
  });
});
