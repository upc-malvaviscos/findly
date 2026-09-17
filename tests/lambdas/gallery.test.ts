import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi
    .fn()
    .mockResolvedValue(
      'http://localhost:4566/findly-local-photos/demo.jpg?signature=local',
    ),
}));
import { gallery } from '../../src/lambdas/gallery';

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
