import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventCollectionId } from '../../src/shared/lib/rekognitionCollections';

describe('rekognitionCollections', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('preserves the legacy collection id only with explicit local opt-in', () => {
    vi.stubEnv('FINDLY_COLLECTION_NAMESPACE', undefined);
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', undefined);
    vi.stubEnv('FINDLY_ALLOW_LEGACY_COLLECTIONS', '1');
    expect(eventCollectionId('evt-1')).toBe('findly-event-evt-1');
  });

  it('isolates identical event ids between demo and PR environments', () => {
    vi.stubEnv('FINDLY_COLLECTION_NAMESPACE', 'findly-demo');
    const demo = eventCollectionId('evt-identical');
    vi.stubEnv('FINDLY_COLLECTION_NAMESPACE', 'findly-pr-70');
    expect(eventCollectionId('evt-identical')).toBe(
      'findly-pr-70-event-evt-identical',
    );
    expect(eventCollectionId('evt-identical')).not.toBe(demo);
  });

  it('requires configuration in AWS even when the local legacy flag is set', () => {
    vi.stubEnv('FINDLY_COLLECTION_NAMESPACE', undefined);
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'findly-demo-selfie-indexer');
    vi.stubEnv('FINDLY_ALLOW_LEGACY_COLLECTIONS', '1');
    expect(() => eventCollectionId('evt-1')).toThrow(
      'COLLECTION_NAMESPACE_REQUIRED',
    );
  });

  it('requires explicit opt-in outside AWS too', () => {
    vi.stubEnv('FINDLY_COLLECTION_NAMESPACE', undefined);
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', undefined);
    vi.stubEnv('FINDLY_ALLOW_LEGACY_COLLECTIONS', undefined);
    expect(() => eventCollectionId('evt-1')).toThrow(
      'COLLECTION_NAMESPACE_REQUIRED',
    );
  });

  it('does not allow a local legacy flag to access AWS from a normal process', () => {
    vi.stubEnv('FINDLY_COLLECTION_NAMESPACE', undefined);
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', undefined);
    vi.stubEnv('FINDLY_ALLOW_LEGACY_COLLECTIONS', '1');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AWS_ENDPOINT_URL', undefined);
    expect(() => eventCollectionId('evt-1')).toThrow(
      'COLLECTION_NAMESPACE_REQUIRED',
    );
  });

  it('allows explicitly configured Floci compatibility without an AWS namespace', () => {
    vi.stubEnv('FINDLY_COLLECTION_NAMESPACE', undefined);
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', undefined);
    vi.stubEnv('FINDLY_ALLOW_LEGACY_COLLECTIONS', '1');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AWS_ENDPOINT_URL', 'http://floci:4566');
    expect(eventCollectionId('evt-1')).toBe('findly-event-evt-1');
  });

  it.each([
    'findly',
    'findly/demo',
    '-findly-demo',
    'findly-demo-',
    'findly-DEMO',
  ])('rejects unsafe or ambiguous namespace %s', (namespace) => {
    vi.stubEnv('FINDLY_COLLECTION_NAMESPACE', namespace);
    expect(() => eventCollectionId('evt-1')).toThrow(
      'INVALID_COLLECTION_NAMESPACE',
    );
  });

  it('rejects invalid event identifiers and overlong collection ids', () => {
    vi.stubEnv('FINDLY_COLLECTION_NAMESPACE', 'findly-demo');
    expect(() => eventCollectionId('evt/other')).toThrow(
      'INVALID_COLLECTION_EVENT_ID',
    );
    expect(() => eventCollectionId('x'.repeat(255))).toThrow(
      'COLLECTION_ID_TOO_LONG',
    );
  });
});
