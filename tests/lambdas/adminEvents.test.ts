import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureLogs } from './lib/logCapture';
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
const openEvent = {
  eventId: 'evt-1',
  createdAt: new Date().toISOString(),
  retentionDays: 30,
  status: 'OPEN',
};
afterEach(() => {
  dynamoMock.reset();
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
