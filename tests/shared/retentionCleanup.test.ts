import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupDeadline,
  localCleanupWithoutBiometrics,
  isRetentionLocator,
  retentionLocatorKey,
} from '../../src/shared/lib/retentionCleanup';

afterEach(() => vi.unstubAllEnvs());

describe('durable retention locator', () => {
  it('uses the event partition with an independently discoverable retention key', () => {
    expect(retentionLocatorKey('evt-1', 'reg-1')).toEqual({
      PK: 'EVENT#evt-1',
      SK: 'RETENTION#reg-1',
    });
  });
  it('recognizes only a locator belonging to its declared event and registration', () => {
    const item = {
      ...retentionLocatorKey('evt-1', 'reg-1'),
      eventId: 'evt-1',
      registrationId: 'reg-1',
      selfieS3Key: 'events/evt-1/selfies/reg-1.selfie.jpg',
    };
    expect(isRetentionLocator(item)).toBe(true);
    expect(isRetentionLocator(undefined)).toBe(false);
    expect(isRetentionLocator({ ...item, PK: 'EVENT#other' })).toBe(false);
    expect(isRetentionLocator({ ...item, SK: 'REG#reg-1' })).toBe(false);
    expect(isRetentionLocator({ ...item, selfieS3Key: undefined })).toBe(false);
  });
  it('waits at least the URL validity, configured async event age and worker timeout', () => {
    expect(cleanupDeadline(2000, 1000)).toBe(23610);
    expect(cleanupDeadline(900, 1000)).toBe(22610);
    expect(cleanupDeadline(undefined, 1000)).toBe(22910);
    expect(cleanupDeadline(undefined)).toBeGreaterThan(
      Math.floor(Date.now() / 1000),
    );
  });
  it('allows storage-only cleanup only in explicit local emulation without any known face', () => {
    expect(localCleanupWithoutBiometrics(undefined, 0)).toBe(false);
    expect(localCleanupWithoutBiometrics('http://localhost:4566', 0)).toBe(
      false,
    );
    vi.stubEnv('FINDLY_LOCAL_NO_BIOMETRICS', '1');
    expect(localCleanupWithoutBiometrics('http://localhost:4566', 0)).toBe(
      true,
    );
    expect(localCleanupWithoutBiometrics('http://floci:4566', 0)).toBe(true);
    expect(localCleanupWithoutBiometrics('http://127.0.0.1:4566', 0)).toBe(
      true,
    );
    expect(localCleanupWithoutBiometrics('http://localhost:4566', 1)).toBe(
      false,
    );
    expect(localCleanupWithoutBiometrics('https://aws.example', 0)).toBe(false);
    expect(localCleanupWithoutBiometrics('invalid', 0)).toBe(false);
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'deployed-lambda');
    expect(localCleanupWithoutBiometrics('http://localhost:4566', 0)).toBe(
      false,
    );
  });
});
