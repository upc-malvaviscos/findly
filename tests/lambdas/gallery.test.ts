import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi
    .fn()
    .mockResolvedValue(
      'http://localhost:4566/findly-local-photos/demo.jpg?signature=local',
    ),
}));
import { gallery } from '../../src/lambdas/gallery';
import { captureLogs } from './lib/logCapture';

const dynamoMock = mockClient(DynamoDBDocumentClient);

afterEach(() => dynamoMock.reset());

describe('gallery lambda', () => {
  it('rejects requests without a token', async () => {
    const result = await gallery({ queryStringParameters: {} });
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('returns not found without revealing the token', async () => {
    dynamoMock.on(GetCommand).resolves({});
    const result = await gallery({
      queryStringParameters: { token: 'secret-token' },
    });
    expect(result.statusCode).toBe(404);
    expect(result.body).not.toContain('secret-token');
    expect(dynamoMock.commandCalls(GetCommand)[0]?.args[0].input).toMatchObject(
      { ConsistentRead: true },
    );
  });

  it('returns expired for a known expired token', async () => {
    dynamoMock.on(GetCommand).resolves({
      Item: {
        registrationId: 'registration-demo',
        eventId: 'demo-2026',
        expiresAt: '2020-01-01T00:00:00.000Z',
      },
    });
    const result = await gallery({
      queryStringParameters: { token: 'expired-token' },
    });
    expect(result.statusCode).toBe(410);
    expect(JSON.parse(result.body)).toMatchObject({ code: 'GALLERY_EXPIRED' });
  });

  it('builds a gallery from matches and the event photo records', async () => {
    dynamoMock
      .on(GetCommand)
      .resolvesOnce({
        Item: {
          registrationId: 'registration-demo',
          eventId: 'demo-2026',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      })
      .resolvesOnce({ Item: { name: 'Local Demo' } })
      .resolvesOnce({ Item: { s3Key: 'events/demo-2026/photos/photo-1.jpg' } });
    dynamoMock.on(QueryCommand).resolves({
      Items: [{ photoId: 'photo-1', matchedAt: '2026-09-04T10:00:00.000Z' }],
    });

    const result = await gallery({
      queryStringParameters: { token: 'demo-gallery' },
    });
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({
      eventId: 'demo-2026',
      eventName: 'Local Demo',
      registrationId: 'registration-demo',
      photos: [{ photoId: 'photo-1' }],
    });
  });

  it('returns an empty gallery when matched photo metadata is no longer available', async () => {
    dynamoMock
      .on(GetCommand)
      .resolvesOnce({
        Item: {
          registrationId: 'registration-demo',
          eventId: 'demo-2026',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      })
      .resolvesOnce({ Item: { name: 'Local Demo' } })
      .resolvesOnce({});
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        { photoId: 'removed-photo', matchedAt: '2026-09-04T10:00:00.000Z' },
      ],
    });

    const result = await gallery({
      queryStringParameters: { token: 'demo-gallery' },
    });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({
      registrationId: 'registration-demo',
      photos: [],
    });
  });
});

describe('gallery structured logging', () => {
  let logs: ReturnType<typeof captureLogs>;
  beforeEach(() => {
    logs = captureLogs();
  });
  afterEach(() => logs.restore());

  it('logs one summary line correlated to the API Gateway request, never the token', async () => {
    dynamoMock.on(GetCommand).resolves({});
    const result = await gallery({
      queryStringParameters: { token: 'secret-token' },
      requestContext: { requestId: 'apigw-req-1' },
    });
    expect(logs.records()).toEqual([
      expect.objectContaining({
        level: 'WARN',
        event: 'gallery_request',
        correlationId: 'apigw-req-1',
        statusCode: 404,
      }),
    ]);
    expect(JSON.parse(result.body).requestId).toBe('apigw-req-1');
    expect(logs.lines.join('')).not.toContain('secret-token');
  });

  it('falls back to the Lambda request ID when there is no API Gateway one', async () => {
    const result = await gallery(
      { queryStringParameters: {} },
      { awsRequestId: 'lambda-req-1' },
    );
    expect(logs.records()[0]).toMatchObject({
      correlationId: 'lambda-req-1',
      statusCode: 400,
    });
    expect(JSON.parse(result.body).requestId).toBe('lambda-req-1');
  });

  it('logs the event and photo count of a served gallery, not names or URLs', async () => {
    dynamoMock
      .on(GetCommand)
      .resolvesOnce({
        Item: {
          registrationId: 'registration-demo',
          eventId: 'demo-2026',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      })
      .resolvesOnce({ Item: { name: 'Private Launch Party' } })
      .resolvesOnce({ Item: { s3Key: 'events/demo-2026/photos/photo-1.jpg' } });
    dynamoMock.on(QueryCommand).resolves({
      Items: [{ photoId: 'photo-1', matchedAt: '2026-09-04T10:00:00.000Z' }],
    });

    await gallery({
      queryStringParameters: { token: 'demo-gallery' },
      requestContext: { requestId: 'apigw-req-2' },
    });

    expect(logs.records()).toEqual([
      expect.objectContaining({
        level: 'INFO',
        eventId: 'demo-2026',
        photoCount: 1,
        statusCode: 200,
      }),
    ]);
    const output = logs.lines.join('');
    expect(output).not.toContain('demo-gallery');
    expect(output).not.toContain('Private Launch Party');
    expect(output).not.toContain('registration-demo');
    expect(output).not.toContain('signature=local');
  });

  it('logs an ERROR with only the error name when a dependency fails, then rethrows', async () => {
    const failure = new Error('table findly-secret is unreachable');
    failure.name = 'ServiceUnavailableException';
    dynamoMock.on(GetCommand).rejects(failure);

    await expect(
      gallery({ queryStringParameters: { token: 'secret-token' } }),
    ).rejects.toBe(failure);

    expect(logs.records()).toEqual([
      expect.objectContaining({
        level: 'ERROR',
        event: 'gallery_request_failed',
        errorName: 'ServiceUnavailableException',
      }),
    ]);
    expect(logs.lines.join('')).not.toContain('findly-secret');
    expect(logs.lines.join('')).not.toContain('secret-token');
  });
});

describe('emailed gallery capabilities', () => {
  it.each([undefined, { erasureRequestedAt: 'synthetic' }])(
    'rejects capability after registration removal or revocation (%j)',
    async (registration) => {
      dynamoMock.on(GetCommand).callsFake((input) =>
        input.Key?.PK.startsWith('TOKEN#')
          ? {
              Item: {
                registrationId: 'synthetic-reg',
                eventId: 'synthetic-event',
                expiresAt: '2099-01-01T00:00:00Z',
                requireRegistration: true,
              },
            }
          : { Item: registration },
      );
      const result = await gallery({
        queryStringParameters: { token: 'synthetic-email-token' },
      });
      expect(result.statusCode).toBe(404);
      expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
    },
  );
  it('opens a current emailed capability without requiring the original token', async () => {
    dynamoMock.on(GetCommand).callsFake((input) =>
      input.Key?.PK.startsWith('TOKEN#')
        ? {
            Item: {
              registrationId: 'synthetic-reg',
              eventId: 'synthetic-event',
              expiresAt: '2099-01-01T00:00:00Z',
              requireRegistration: true,
            },
          }
        : input.Key?.SK.startsWith('REG#')
          ? { Item: { registrationId: 'synthetic-reg' } }
          : { Item: { name: 'Synthetic' } },
    );
    dynamoMock.on(QueryCommand).resolves({ Items: [] });
    expect(
      (
        await gallery({
          queryStringParameters: { token: 'synthetic-email-token' },
        })
      ).statusCode,
    ).toBe(200);
  });
});
