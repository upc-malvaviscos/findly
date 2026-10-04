import { describe, expect, it } from 'vitest';
import {
  clientEnrollmentErrorSchema,
  toClientEnrollmentErrorCode,
} from '../../src/shared/lib/enrollmentErrorTelemetry';

describe('client enrollment error contract (ADR-018)', () => {
  it('keeps known codes and groups HTTP statuses by class', () => {
    expect(toClientEnrollmentErrorCode(new Error('NETWORK_ERROR'))).toBe(
      'NETWORK_ERROR',
    );
    expect(toClientEnrollmentErrorCode(new Error('UPLOAD_FAILED_403'))).toBe(
      'UPLOAD_HTTP_4XX',
    );
    expect(toClientEnrollmentErrorCode(new Error('UPLOAD_FAILED_503'))).toBe(
      'UPLOAD_HTTP_5XX',
    );
    expect(toClientEnrollmentErrorCode(new Error('HTTP_429'))).toBe('HTTP_4XX');
    expect(toClientEnrollmentErrorCode(new Error('HTTP_502'))).toBe('HTTP_5XX');
  });

  it('maps free text, identifiers and non-errors to UNKNOWN', () => {
    for (const error of [
      new Error('Failed for user@example.com'),
      new Error('https://bucket.s3.amazonaws.com/key?X-Amz-Signature=x'),
      new Error('UPLOAD_FAILED_200'),
      'NETWORK_ERROR',
      undefined,
    ])
      expect(toClientEnrollmentErrorCode(error)).toBe('UNKNOWN');
  });

  it('accepts only the stage and code enums', () => {
    expect(
      clientEnrollmentErrorSchema.safeParse({
        stage: 'upload',
        code: 'UPLOAD_TIMEOUT',
      }).success,
    ).toBe(true);
    expect(
      clientEnrollmentErrorSchema.safeParse({
        stage: 'upload',
        code: 'UPLOAD_TIMEOUT',
        eventId: 'synthetic',
      }).success,
    ).toBe(false);
  });
});
