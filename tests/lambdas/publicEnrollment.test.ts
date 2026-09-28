import { createPresignedUploadUrl } from '../../src/lambdas/lib/presignedUpload';
import { createHash } from 'node:crypto';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/lambdas/lib/presignedUpload', () => ({
  createPresignedUploadUrl: vi.fn().mockResolvedValue({
    uploadUrl: 'https://synthetic.invalid/put',
    expiresInSeconds: 300,
  }),
}));
import {
  createPublicRegistration,
  getPublicRegistrationStatus,
} from '../../src/lambdas/publicEnrollment';
const db = mockClient(DynamoDBDocumentClient);
const request = {
  pathParameters: { eventId: 'demo' },
  body: JSON.stringify({ consentBiometrics: true, consentTerms: true }),
};
beforeEach(() => {
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
