import { afterEach, describe, expect, it } from 'vitest';
import {
  emitLog,
  errorNameOf,
  resolveCorrelationId,
  withRequestLog,
  type LogFields,
} from '../../../src/lambdas/lib/logger';
import { captureLogs } from './logCapture';

let logs: ReturnType<typeof captureLogs> | undefined;
afterEach(() => logs?.restore());

function capture() {
  logs = captureLogs();
  return logs;
}

describe('resolveCorrelationId', () => {
  it('prefers the first usable identifier', () => {
    expect(resolveCorrelationId('Xk3sLg3PjoEEJOw=', 'lambda-request')).toBe(
      'Xk3sLg3PjoEEJOw=',
    );
    expect(resolveCorrelationId(undefined, null, 'lambda-request')).toBe(
      'lambda-request',
    );
  });

  it('falls back to a fresh UUID when no identifier is usable', () => {
    expect(resolveCorrelationId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it.each([
    ['a value containing a newline', 'abc\nINJECTED'],
    ['a value containing spaces', 'not an id'],
    ['an empty value', ''],
    ['an over-long value', 'a'.repeat(129)],
  ])('ignores %s', (_label, candidate) => {
    expect(resolveCorrelationId(candidate, 'fallback-id')).toBe('fallback-id');
  });
});

describe('errorNameOf', () => {
  it('returns the class name and never the message', () => {
    const error = new Error('bucket findly-secret key events/evt-1/x.jpg');
    error.name = 'AccessDeniedException';
    expect(errorNameOf(error)).toBe('AccessDeniedException');
  });

  it('accepts plain objects carrying a name, as SDK mocks do', () => {
    expect(errorNameOf({ name: 'ConditionalCheckFailedException' })).toBe(
      'ConditionalCheckFailedException',
    );
  });

  it.each([undefined, null, 'boom', 42, { name: 'has spaces!' }])(
    'reports UnknownError for %j',
    (thrown) => {
      expect(errorNameOf(thrown)).toBe('UnknownError');
    },
  );
});

describe('emitLog', () => {
  it('writes one JSON line with level, event and correlationId', () => {
    const output = capture();
    emitLog('INFO', 'gallery_request', 'corr-1', {
      eventId: 'evt-1',
      statusCode: 200,
      durationMs: 12,
      faceDeleted: true,
    });
    expect(output.records()).toEqual([
      {
        level: 'INFO',
        event: 'gallery_request',
        correlationId: 'corr-1',
        eventId: 'evt-1',
        statusCode: 200,
        durationMs: 12,
        faceDeleted: true,
      },
    ]);
  });

  it('routes WARN and ERROR to their console methods', () => {
    const output = capture();
    emitLog('WARN', 'a', 'c');
    emitLog('ERROR', 'b', 'c');
    expect(output.records().map((record) => record.level)).toEqual([
      'WARN',
      'ERROR',
    ]);
  });

  it('drops fields outside the allow-list even when a caller casts past the type', () => {
    const output = capture();
    emitLog('INFO', 'x', 'c', {
      eventId: 'evt-1',
      email: 'ada@example.com',
      token: 'secret-gallery-token',
      registrationId: 'reg-1',
    } as LogFields);
    expect(output.records()[0]).not.toHaveProperty('email');
    expect(output.records()[0]).not.toHaveProperty('token');
    expect(output.records()[0]).not.toHaveProperty('registrationId');
    expect(output.lines.join('')).not.toContain('ada@example.com');
    expect(output.lines.join('')).not.toContain('secret-gallery-token');
  });

  it('redacts a string field that is not shaped like an identifier', () => {
    const output = capture();
    emitLog('INFO', 'x', 'c', { eventId: 'ada@example.com' });
    expect(output.records()[0]).toMatchObject({ eventId: '[redacted]' });
    expect(output.lines.join('')).not.toContain('ada@example.com');
  });

  it('omits undefined fields', () => {
    const output = capture();
    emitLog('INFO', 'x', 'c', { eventId: undefined, statusCode: 204 });
    expect(output.records()[0]).toEqual({
      level: 'INFO',
      event: 'x',
      correlationId: 'c',
      statusCode: 204,
    });
  });
});

describe('withRequestLog', () => {
  it('writes one summary line with status, duration and annotations', async () => {
    const output = capture();
    const result = await withRequestLog(
      'demo_request',
      { requestId: 'apigw-1', awsRequestId: 'lambda-1' },
      async (request) => {
        request.annotate({ eventId: 'evt-1', photoCount: 3 });
        return { statusCode: 200 };
      },
    );
    expect(result).toEqual({ statusCode: 200 });
    expect(output.records()).toHaveLength(1);
    expect(output.records()[0]).toMatchObject({
      level: 'INFO',
      event: 'demo_request',
      correlationId: 'apigw-1',
      eventId: 'evt-1',
      photoCount: 3,
      statusCode: 200,
    });
    expect(output.records()[0]?.durationMs).toEqual(expect.any(Number));
  });

  it('exposes the correlation ID so handlers can return it as requestId', async () => {
    capture();
    let seen = '';
    await withRequestLog(
      'demo_request',
      { awsRequestId: 'lambda-1' },
      async (request) => {
        seen = request.correlationId;
        return { statusCode: 204 };
      },
    );
    expect(seen).toBe('lambda-1');
  });

  it.each([
    [404, 'WARN'],
    [410, 'WARN'],
    [500, 'ERROR'],
  ])('logs status %i at level %s', async (statusCode, level) => {
    const output = capture();
    await withRequestLog('demo_request', {}, async () => ({ statusCode }));
    expect(output.records()[0]).toMatchObject({ level, statusCode });
  });

  it('logs an ERROR with the error name only, then rethrows', async () => {
    const output = capture();
    const failure = new Error('secret bucket findly-secret is unreachable');
    failure.name = 'ServiceUnavailableException';
    await expect(
      withRequestLog(
        'demo_request',
        { requestId: 'apigw-1' },
        async (request) => {
          request.annotate({ eventId: 'evt-1' });
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
    expect(output.records()).toEqual([
      expect.objectContaining({
        level: 'ERROR',
        event: 'demo_request_failed',
        correlationId: 'apigw-1',
        eventId: 'evt-1',
        errorName: 'ServiceUnavailableException',
      }),
    ]);
    expect(output.lines.join('')).not.toContain('findly-secret');
  });

  it('lets a handler write extra audit lines under the same correlation ID', async () => {
    const output = capture();
    await withRequestLog(
      'demo_request',
      { requestId: 'apigw-1' },
      async (request) => {
        request.info('registration_erased', { eventId: 'evt-1' });
        return { statusCode: 204 };
      },
    );
    expect(output.records().map((record) => record.event)).toEqual([
      'registration_erased',
      'demo_request',
    ]);
    expect(
      output.records().every((record) => record.correlationId === 'apigw-1'),
    ).toBe(true);
  });
});
