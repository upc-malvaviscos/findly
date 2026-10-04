import { createPresignedUploadUrl } from '../../src/lambdas/lib/presignedUpload';
import { createHash } from 'node:crypto';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/lambdas/lib/presignedUpload', () => ({
  createPresignedUploadUrl: vi.fn().mockResolvedValue({
    uploadUrl: 'https://synthetic.invalid/put',
    expiresInSeconds: 300,
  }),
}));
import {
  createPublicRegistration,
  getPublicRegistrationStatus,
  reportClientEnrollmentError,
} from '../../src/lambdas/publicEnrollment';
import { captureLogs } from './lib/logCapture';
const db = mockClient(DynamoDBDocumentClient);
const request = {
  pathParameters: { eventId: 'demo' },
  body: JSON.stringify({ consentBiometrics: true, consentTerms: true }),
};
beforeEach(() => {
  vi.unstubAllEnvs();
  db.reset();
  db.on(GetCommand).resolves({
    Item: {
      eventId: 'demo',
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      retentionDays: 3,
    },
  });
  db.on(TransactWriteCommand).resolves({});
});
describe('public enrollment', () => {
  it('requires both consents and rejects malformed input before AWS writes', async () => {
    for (const body of [
      'bad',
      '{}',
      JSON.stringify({ consentBiometrics: true, consentTerms: false }),
    ])
      expect(
        (await createPublicRegistration({ ...request, body })).statusCode,
      ).toBe(400);
    expect(db.calls()).toHaveLength(0);
  });
  it('issues an opaque capability and atomically persists only its hash', async () => {
    vi.stubEnv('FINDLY_COLLECTION_NAMESPACE', 'findly-pr-71');
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'findly-pr-71-public-register');
    const result = await createPublicRegistration(request);
    expect(result.statusCode).toBe(201);
    const payload = JSON.parse(result.body) as {
      galleryToken: string;
      registrationId: string;
      expiresInSeconds: number;
    };
    expect(payload.galleryToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(payload.expiresInSeconds).toBe(300);
    const transaction = db.commandCalls(TransactWriteCommand)[0]?.args[0].input;
    expect(JSON.stringify(transaction)).not.toContain(payload.galleryToken);
    const hash = createHash('sha256')
      .update(payload.galleryToken)
      .digest('hex');
    expect(transaction?.TransactItems?.[1]?.Put?.Item).toMatchObject({
      tokenHash: hash,
      status: 'UPLOAD_PENDING',
    });
    expect(transaction?.TransactItems).toHaveLength(4);
    expect(transaction?.TransactItems?.[3]?.Put?.Item).toMatchObject({
      PK: 'EVENT#demo',
      SK: `RETENTION#${payload.registrationId}`,
      tokenHash: hash,
      cleanupState: 'ACTIVE',
      collectionId: 'findly-pr-71-event-demo',
    });
    expect(transaction?.TransactItems?.[3]?.Put?.Item).not.toHaveProperty(
      'ttl',
    );
    expect(createPresignedUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ writeOnce: true, expiresInSeconds: 300 }),
    );
    expect(transaction?.TransactItems?.[2]?.Put?.Item).toMatchObject({
      PK: `TOKEN#${hash}`,
      registrationId: payload.registrationId,
    });
  });
  it('bounds selfie PUT expiry by the event deadline', async () => {
    const deadline = Date.now() + 40000;
    db.on(GetCommand).resolves({
      Item: {
        status: 'OPEN',
        createdAt: new Date(deadline - 86400000).toISOString(),
        retentionDays: 1,
      },
    });
    await createPublicRegistration(request);
    const call = vi.mocked(createPresignedUploadUrl).mock.calls.at(-1)?.[0];
    expect(call?.expiresInSeconds).toBeGreaterThan(0);
    expect(call?.expiresInSeconds).toBeLessThanOrEqual(40);
  });
  it('rejects closed, missing and expired events', async () => {
    db.on(GetCommand)
      .resolvesOnce({})
      .resolvesOnce({ Item: { status: 'CLOSED' } })
      .resolves({
        Item: { status: 'OPEN', createdAt: '2000-01-01', retentionDays: 1 },
      });
    expect((await createPublicRegistration(request)).statusCode).toBe(404);
    expect((await createPublicRegistration(request)).statusCode).toBe(404);
    expect((await createPublicRegistration(request)).statusCode).toBe(410);
    expect(db.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
  it('authorizes polling from token lookup without scanning or new indexes', async () => {
    db.on(GetCommand)
      .resolvesOnce({
        Item: {
          eventId: 'demo',
          registrationId: 'reg',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      })
      .resolvesOnce({ Item: { status: 'ENROLLED' } })
      .resolvesOnce({ Item: { cleanupState: 'ACTIVE' } });
    const result = await getPublicRegistrationStatus({
      pathParameters: { registrationId: 'reg' },
      headers: { 'X-Gallery-Token': 'synthetic-token' },
    });
    expect(JSON.parse(result.body)).toEqual({
      registrationId: 'reg',
      status: 'ENROLLED',
    });
    expect(db.commandCalls(GetCommand)[1]?.args[0].input.Key).toEqual({
      PK: 'EVENT#demo',
      SK: 'REG#reg',
    });
  });
  it('rejects missing, mismatched, expired or erased capabilities', async () => {
    const polling = {
      pathParameters: { registrationId: 'reg' },
      headers: { 'x-gallery-token': 'synthetic-token' },
    };
    expect((await getPublicRegistrationStatus({})).statusCode).toBe(400);
    db.on(GetCommand).resolves({});
    expect((await getPublicRegistrationStatus(polling)).statusCode).toBe(404);
    db.on(GetCommand).resolves({ Item: { registrationId: 'other' } });
    expect((await getPublicRegistrationStatus(polling)).statusCode).toBe(404);
    db.on(GetCommand).resolves({
      Item: { registrationId: 'reg', expiresAt: '2000-01-01' },
    });
    expect((await getPublicRegistrationStatus(polling)).statusCode).toBe(410);
    db.reset();
    db.on(GetCommand)
      .resolvesOnce({
        Item: {
          registrationId: 'reg',
          eventId: 'demo',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      })
      .resolvesOnce({});
    expect((await getPublicRegistrationStatus(polling)).statusCode).toBe(404);
  });
  it('does not expose status once a registration or locator is marked for erasure', async () => {
    const polling = {
      pathParameters: { registrationId: 'reg' },
      headers: { 'X-Gallery-Token': 'synthetic-token' },
    };
    const token = {
      eventId: 'demo',
      registrationId: 'reg',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
    db.reset();
    db.on(GetCommand)
      .resolvesOnce({ Item: token })
      .resolvesOnce({
        Item: { status: 'PROCESSING', erasureRequestedAt: 'now' },
      });
    expect((await getPublicRegistrationStatus(polling)).statusCode).toBe(404);
    db.reset();
    db.on(GetCommand)
      .resolvesOnce({ Item: token })
      .resolvesOnce({ Item: { status: 'PROCESSING' } })
      .resolvesOnce({ Item: { cleanupState: 'DELETING' } });
    expect((await getPublicRegistrationStatus(polling)).statusCode).toBe(404);
  });
});

describe('client enrollment error telemetry (ADR-018)', () => {
  let logs: ReturnType<typeof captureLogs>;
  beforeEach(() => {
    logs = captureLogs();
  });
  afterEach(() => logs.restore());

  it('logs only the stage and closed code of a valid report, without AWS calls', async () => {
    for (const stage of ['registration', 'upload', 'polling'])
      expect(
        (
          await reportClientEnrollmentError({
            body: JSON.stringify({ stage, code: 'NETWORK_ERROR' }),
            headers: { 'x-gallery-token': 'synthetic-token' },
            requestContext: { requestId: 'req-telemetry' },
          })
        ).statusCode,
      ).toBe(204);
    expect(db.calls()).toHaveLength(0);
    const reports = logs
      .records()
      .filter((record) => record.event === 'client_enrollment_error');
    expect(reports.map((record) => record.stage)).toEqual([
      'registration',
      'upload',
      'polling',
    ]);
    for (const record of reports)
      expect(Object.keys(record).sort()).toEqual([
        'clientErrorCode',
        'correlationId',
        'event',
        'level',
        'stage',
      ]);
    expect(logs.lines.join('\n')).not.toContain('synthetic-token');
  });

  it('rejects unknown values, extra fields, oversized and malformed bodies without logging a report', async () => {
    for (const body of [
      null,
      'not-json',
      JSON.stringify({ stage: 'gallery', code: 'NETWORK_ERROR' }),
      JSON.stringify({ stage: 'upload', code: 'user@example.com' }),
      JSON.stringify({
        stage: 'upload',
        code: 'UPLOAD_FAILED',
        registrationId: 'reg-synthetic',
      }),
      JSON.stringify({ stage: 'upload', code: 'UPLOAD_FAILED' }) +
        ' '.repeat(300),
    ]) {
      const result = await reportClientEnrollmentError({ body });
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        code: 'INVALID_REQUEST',
      });
    }
    expect(
      logs
        .records()
        .some((record) => record.event === 'client_enrollment_error'),
    ).toBe(false);
    expect(logs.lines.join('\n')).not.toMatch(/user@example|reg-synthetic/);
  });
});
