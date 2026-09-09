import { describe, expect, it } from 'vitest';
import {
  eventPhotoObjectKey,
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
});
