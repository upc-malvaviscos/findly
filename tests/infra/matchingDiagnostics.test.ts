import { describe, expect, it } from 'vitest';
import { sanitizeMatchingLogs } from '../../scripts/diagnose-matching.mjs';

describe('matching diagnostics privacy', () => {
  it('keeps processing metadata and drops private payloads and unsafe strings', () => {
    const result = sanitizeMatchingLogs([
      {
        timestamp: 1000,
        message:
          'prefix ' +
          JSON.stringify({
            event: 'photo_matching_failed',
            level: 'ERROR',
            errorName: 'ResourceNotFoundException',
            step: 'index_faces',
            failedCount: 1,
            token: 'private-token',
            faceId: 'private-face',
            registrationId: 'private-registration',
            email: 'private@example.test',
            message: 'private error',
            eventId: 'private-event',
            photoId: 'private-photo',
            correlationId: 'private-correlation',
            photoCount: Number.POSITIVE_INFINITY,
            recordCount: 'unsafe@example.test',
          }),
      },
    ]);
    expect(result).toEqual([
      {
        timestamp: 1000,
        event: 'photo_matching_failed',
        level: 'ERROR',
        errorName: 'ResourceNotFoundException',
        step: 'index_faces',
        failedCount: 1,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/private|example\.test/);
  });
  it('ignores raw Lambda messages, malformed JSON and unknown fields', () => {
    expect(
      sanitizeMatchingLogs([
        { message: 'START RequestId: private' },
        { message: '{broken private' },
        { message: '{"token":"private"}' },
        { message: 'null' },
        { message: '[]' },
      ]),
    ).toEqual([]);
  });
});
