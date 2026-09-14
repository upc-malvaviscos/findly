import { describe, expect, it } from 'vitest';
import { eventCollectionId } from '../../src/shared/lib/rekognitionCollections';

describe('rekognitionCollections', () => {
  it('builds the per-event Rekognition collection id', () => {
    expect(eventCollectionId('evt-1')).toBe('findly-event-evt-1');
  });
});
