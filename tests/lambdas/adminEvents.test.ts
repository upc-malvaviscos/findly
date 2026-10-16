import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureLogs } from './lib/logCapture';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
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
  deleteAdminEvent,
  deleteEventPhoto,
  listAdminEvents,
  listEventPhotos,
  updateAdminEvent,
} from '../../src/lambdas/adminEvents';

const dynamoMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);
const openEvent = {
  eventId: 'evt-1',
  createdAt: new Date().toISOString(),
  retentionDays: 30,
  status: 'OPEN',
};
afterEach(() => {
  dynamoMock.reset();
  s3Mock.reset();
  signMock.mockClear();
});

describe('admin events handlers', () => {
  it.each([
    { ...openEvent, createdAt: '2000-01-01T00:00:00.000Z' },
    { ...openEvent, status: 'CLOSED' },
    { ...openEvent, createdAt: 'invalid' },
  ])(
    'does not issue a new PUT capability for an expired or invalid event',
    async (Item) => {
      dynamoMock.on(GetCommand).resolves({ Item });
      const result = await createPhotoUploads({
        pathParameters: { eventId: 'evt-1' },
        body: JSON.stringify({
          files: [{ fileName: 'photo.jpg', contentType: 'image/jpeg' }],
        }),
      });
      expect(result.statusCode).toBe(410);
      expect(signMock).not.toHaveBeenCalled();
      expect(dynamoMock.commandCalls(PutCommand)).toHaveLength(0);
    },
  );
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
    dynamoMock.on(GetCommand).resolves({ Item: openEvent });
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

describe('admin events structured logging', () => {
  let logs: ReturnType<typeof captureLogs>;
  beforeEach(() => {
    logs = captureLogs();
  });
  afterEach(() => logs.restore());

  it('logs the created event by id only, never its name or date', async () => {
    dynamoMock.on(PutCommand).resolves({});
    const result = await createAdminEvent(
      {
        body: JSON.stringify({
          name: 'Confidential Board Retreat',
          date: '2026-10-01T10:00:00.000Z',
          retentionDays: 30,
        }),
        requestContext: { requestId: 'apigw-req-1' },
      },
      { awsRequestId: 'lambda-req-1' },
    );

    expect(logs.records()).toEqual([
      expect.objectContaining({
        level: 'INFO',
        event: 'admin_create_event',
        correlationId: 'apigw-req-1',
        eventId: JSON.parse(result.body).eventId,
        statusCode: 201,
      }),
    ]);
    const output = logs.lines.join('');
    expect(output).not.toContain('Confidential Board Retreat');
    expect(output).not.toContain('2026-10-01');
  });

  it('returns the correlation ID as requestId on validation errors', async () => {
    const result = await createAdminEvent({
      body: '{}',
      requestContext: { requestId: 'apigw-req-2' },
    });
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).requestId).toBe('apigw-req-2');
    expect(logs.records()[0]).toMatchObject({
      level: 'WARN',
      correlationId: 'apigw-req-2',
      statusCode: 400,
    });
  });

  it('does not log an unvalidated eventId taken from the URL', async () => {
    dynamoMock.on(GetCommand).resolves({});
    await createPhotoUploads({
      pathParameters: { eventId: 'victim@example.com' },
      body: JSON.stringify({
        files: [{ fileName: 'photo.jpg', contentType: 'image/jpeg' }],
      }),
    });
    expect(logs.records()).toEqual([
      expect.objectContaining({ level: 'WARN', statusCode: 404 }),
    ]);
    expect(logs.records()[0]).not.toHaveProperty('eventId');
    expect(logs.lines.join('')).not.toContain('victim@example.com');
  });

  it('logs the event and upload count once the event exists, without URLs', async () => {
    dynamoMock.on(GetCommand).resolves({ Item: openEvent });
    dynamoMock.on(PutCommand).resolves({});
    await createPhotoUploads(
      {
        pathParameters: { eventId: 'evt-1' },
        body: JSON.stringify({
          files: [
            { fileName: 'a.jpg', contentType: 'image/jpeg' },
            { fileName: 'b.jpg', contentType: 'image/jpeg' },
          ],
        }),
      },
      { awsRequestId: 'lambda-req-3' },
    );
    expect(logs.records()).toEqual([
      expect.objectContaining({
        level: 'INFO',
        event: 'admin_create_photo_uploads',
        correlationId: 'lambda-req-3',
        eventId: 'evt-1',
        photoCount: 2,
        statusCode: 200,
      }),
    ]);
    expect(logs.lines.join('')).not.toContain('s3.example.test');
  });

  it('logs the list request without its result payload', async () => {
    dynamoMock
      .on(QueryCommand)
      .resolves({ Items: [{ eventId: 'evt-1', name: 'Secret Gala' }] });
    await listAdminEvents(
      { requestContext: { requestId: 'apigw-req-4' } },
      { awsRequestId: 'lambda-req-4' },
    );
    expect(logs.records()).toEqual([
      expect.objectContaining({
        event: 'admin_list_events',
        correlationId: 'apigw-req-4',
        statusCode: 200,
      }),
    ]);
    expect(logs.lines.join('')).not.toContain('Secret Gala');
  });
});

describe('updateAdminEvent', () => {
  it('rejects an empty payload', async () => {
    const result = await updateAdminEvent({
      pathParameters: { eventId: 'evt-1' },
      body: '{}',
    });
    expect(result.statusCode).toBe(400);
    expect(dynamoMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });
  it('returns 404 for an unknown event without a prior read', async () => {
    dynamoMock
      .on(UpdateCommand)
      .rejects({ name: 'ConditionalCheckFailedException' });
    const result = await updateAdminEvent({
      pathParameters: { eventId: 'missing' },
      body: JSON.stringify({ retentionDays: 10 }),
    });
    expect(result.statusCode).toBe(404);
  });
  it('updates only retentionDays without touching GSI2SK', async () => {
    dynamoMock.on(UpdateCommand).resolves({
      Attributes: { ...openEvent, retentionDays: 10 },
    });
    const result = await updateAdminEvent({
      pathParameters: { eventId: 'evt-1' },
      body: JSON.stringify({ retentionDays: 10 }),
    });
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({
      eventId: 'evt-1',
      retentionDays: 10,
    });
    const input = dynamoMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.UpdateExpression).toBe('SET retentionDays = :retentionDays');
    expect(input?.ExpressionAttributeValues).toEqual({ ':retentionDays': 10 });
  });
  it('recomputes GSI2SK when the date changes', async () => {
    dynamoMock.on(UpdateCommand).resolves({ Attributes: openEvent });
    await updateAdminEvent({
      pathParameters: { eventId: 'evt-1' },
      body: JSON.stringify({ date: '2026-11-01T00:00:00.000Z' }),
    });
    const input = dynamoMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.ExpressionAttributeValues?.[':gsi2sk']).toBe(
      '2026-11-01T00:00:00.000Z#evt-1',
    );
  });
});

describe('listEventPhotos', () => {
  it('returns 404 for an unknown event', async () => {
    dynamoMock.on(GetCommand).resolves({});
    const result = await listEventPhotos({
      pathParameters: { eventId: 'missing' },
    });
    expect(result.statusCode).toBe(404);
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });
  it('rejects a malformed cursor', async () => {
    const result = await listEventPhotos({
      pathParameters: { eventId: 'evt-1' },
      queryStringParameters: { cursor: 'not-base64url-json!!' },
    });
    expect(result.statusCode).toBe(400);
  });
  it('lists photos and encodes a cursor when more pages remain', async () => {
    dynamoMock.on(GetCommand).resolves({ Item: { eventId: 'evt-1' } });
    dynamoMock.on(QueryCommand).resolves({
      Items: [{ photoId: 'p1', uploadedAt: '2026-01-01T00:00:00.000Z' }],
      LastEvaluatedKey: { PK: 'EVENT#evt-1', SK: 'PHOTO#p1' },
    });
    const result = await listEventPhotos({
      pathParameters: { eventId: 'evt-1' },
    });
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.photos).toEqual([
      { photoId: 'p1', uploadedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(typeof body.nextCursor).toBe('string');
    const decoded = JSON.parse(
      Buffer.from(body.nextCursor, 'base64url').toString('utf8'),
    );
    expect(decoded).toEqual({ PK: 'EVENT#evt-1', SK: 'PHOTO#p1' });
  });
});

describe('deleteEventPhoto', () => {
  it('deletes both match items per affected registration, the photo and its object', async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [{ registrationId: 'reg-1' }, { registrationId: 'reg-2' }],
    });
    dynamoMock.on(DeleteCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    const result = await deleteEventPhoto({
      pathParameters: { eventId: 'evt-1', photoId: 'photo-1' },
    });
    expect(result.statusCode).toBe(204);
    const queryInput = dynamoMock.commandCalls(QueryCommand)[0]?.args[0].input;
    expect(queryInput?.ExpressionAttributeValues).toEqual({
      ':pk': 'PHOTO#evt-1#photo-1',
    });
    const deleteKeys = dynamoMock
      .commandCalls(DeleteCommand)
      .map((call) => call.args[0].input.Key);
    expect(deleteKeys).toContainEqual({ PK: 'REG#reg-1', SK: 'MATCH#photo-1' });
    expect(deleteKeys).toContainEqual({
      PK: 'PHOTO#evt-1#photo-1',
      SK: 'MATCH#reg-1',
    });
    expect(deleteKeys).toContainEqual({ PK: 'REG#reg-2', SK: 'MATCH#photo-1' });
    expect(deleteKeys).toContainEqual({
      PK: 'PHOTO#evt-1#photo-1',
      SK: 'MATCH#reg-2',
    });
    expect(deleteKeys).toContainEqual({
      PK: 'EVENT#evt-1',
      SK: 'PHOTO#photo-1',
    });
    expect(
      s3Mock.commandCalls(DeleteObjectCommand)[0]?.args[0].input,
    ).toMatchObject({
      Key: 'events/evt-1/photos/photo-1.photo.jpg',
    });
  });
  it('is idempotent when the photo object is already gone', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });
    dynamoMock.on(DeleteCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).rejects({ name: 'NoSuchKey' });
    const result = await deleteEventPhoto({
      pathParameters: { eventId: 'evt-1', photoId: 'photo-1' },
    });
    expect(result.statusCode).toBe(204);
  });
});

describe('deleteAdminEvent', () => {
  it('is idempotent when the event is already gone', async () => {
    dynamoMock.on(GetCommand).resolves({});
    const result = await deleteAdminEvent({
      pathParameters: { eventId: 'evt-1' },
    });
    expect(result.statusCode).toBe(204);
    expect(dynamoMock.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });
  it('closes the event and cleans up, without destroying the collection synchronously', async () => {
    dynamoMock.on(GetCommand).resolves({ Item: {} });
    dynamoMock.on(UpdateCommand).resolves({});
    dynamoMock.on(QueryCommand).resolves({ Items: [] });
    dynamoMock.on(DeleteCommand).resolves({});
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    const result = await deleteAdminEvent({
      pathParameters: { eventId: 'evt-1' },
    });
    expect(result.statusCode).toBe(204);
    const markInput = dynamoMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(markInput?.ExpressionAttributeValues?.[':closed']).toBe('CLOSED');
    expect(s3Mock.commandCalls(DeleteObjectsCommand)).toHaveLength(0);
    // deadline is anchored on "now" + the ADR-013 margin, always in the
    // future relative to "now": the final event-row delete must not run yet.
    const eventRowDeletes = dynamoMock
      .commandCalls(DeleteCommand)
      .filter(
        (call) =>
          (call.args[0].input.Key as { SK?: string })?.SK === 'METADATA',
      );
    expect(eventRowDeletes).toHaveLength(0);
  });
});
