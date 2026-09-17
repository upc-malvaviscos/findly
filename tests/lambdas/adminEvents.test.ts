import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

const signMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    uploadUrl: 'https://s3.example.test/signed',
    expiresInSeconds: 300,
  }),
);
vi.mock('../../src/lambdas/lib/presignedUpload', () => ({
  createPresignedUploadUrl: signMock,
}));
import {
  createAdminEvent,
  createPhotoUploads,
  listAdminEvents,
} from '../../src/lambdas/adminEvents';

const dynamoMock = mockClient(DynamoDBDocumentClient);
afterEach(() => {
  dynamoMock.reset();
  signMock.mockClear();
});

describe('admin events handlers', () => {
  it('lists events through GSI2 without a scan', async () => {
    dynamoMock
      .on(QueryCommand)
      .resolves({ Items: [{ eventId: 'evt-1', name: 'Demo' }] });
    const result = await listAdminEvents();
    expect(result.statusCode).toBe(200);
    expect(
      dynamoMock.commandCalls(QueryCommand)[0]?.args[0].input,
    ).toMatchObject({
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
    });
  });
  it('rejects invalid event payloads and persists a valid event with GSI2 fields', async () => {
    expect((await createAdminEvent({ body: '{}' })).statusCode).toBe(400);
    dynamoMock.on(PutCommand).resolves({});
    const result = await createAdminEvent({
      body: JSON.stringify({
        name: 'Demo',
        date: '2026-10-01T10:00:00.000Z',
        retentionDays: 30,
      }),
    });
    expect(result.statusCode).toBe(201);
    expect(
      dynamoMock.commandCalls(PutCommand)[0]?.args[0].input.Item,
    ).toMatchObject({ GSI2PK: 'ENTITY#EVENT', status: 'OPEN' });
  });
  it('returns the same event identifier when a create is retried', async () => {
    dynamoMock
      .on(PutCommand)
      .rejects({ name: 'ConditionalCheckFailedException' });
    const payload = {
      name: 'Demo',
      date: '2026-10-01T10:00:00.000Z',
      retentionDays: 30,
    };
    const first = await createAdminEvent({ body: JSON.stringify(payload) });
    const second = await createAdminEvent({ body: JSON.stringify(payload) });
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body).eventId).toBe(
      JSON.parse(second.body).eventId,
    );
  });
  it('requires an existing event and signs JPEG uploads for exactly 300 seconds', async () => {
    dynamoMock.on(GetCommand).resolves({ Item: { eventId: 'evt-1' } });
    dynamoMock.on(PutCommand).resolves({});
    const result = await createPhotoUploads({
      pathParameters: { eventId: 'evt-1' },
      body: JSON.stringify({
        files: [{ fileName: 'photo.jpg', contentType: 'image/jpeg' }],
      }),
    });
    expect(result.statusCode).toBe(200);
    expect(signMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'image/jpeg',
        key: expect.stringMatching(/^events\/evt-1\/photos\/.+\.jpg$/),
      }),
    );
    expect(JSON.parse(result.body).uploads[0].expiresInSeconds).toBe(300);
  });
  it('returns 404 before writing when the event does not exist', async () => {
    dynamoMock.on(GetCommand).resolves({});
    const result = await createPhotoUploads({
      pathParameters: { eventId: 'missing' },
      body: JSON.stringify({
        files: [{ fileName: 'photo.jpg', contentType: 'image/jpeg' }],
      }),
    });
    expect(result.statusCode).toBe(404);
    expect(dynamoMock.commandCalls(PutCommand)).toHaveLength(0);
  });
});
