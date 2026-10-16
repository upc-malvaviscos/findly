import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureLogs } from './lib/logCapture';

vi.mock('../../src/lambdas/lib/matching', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/lambdas/lib/matching')
  >('../../src/lambdas/lib/matching');
  return { ...actual, matchPhoto: vi.fn().mockResolvedValue(undefined) };
});

import { registrationBackfill } from '../../src/lambdas/registrationBackfill';
import { matchPhoto } from '../../src/lambdas/lib/matching';

const dynamoMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);
const matchPhotoMock = matchPhoto as unknown as ReturnType<typeof vi.fn>;

const NOW_EPOCH = Math.floor(Date.now() / 1000);

// FINDLY_PHOTO_BUCKET is read once at module load (like gallery.ts and the
// other lambdas), so it is not overridable per test; assertions below use
// its frozen default, 'findly-local-photos'.
beforeEach(() => {
  process.env.FINDLY_BACKFILL_QUEUE_URL = 'https://sqs.test/backfill-queue';
});

afterEach(() => {
  dynamoMock.reset();
  sqsMock.reset();
  matchPhotoMock.mockReset().mockResolvedValue(undefined);
  delete process.env.FINDLY_BACKFILL_QUEUE_URL;
});

function enrolledRegistration() {
  return {
    PK: 'EVENT#demo-2026',
    SK: 'REG#reg-1',
    registrationId: 'reg-1',
    eventId: 'demo-2026',
    status: 'ENROLLED',
    faceId: 'face-1',
    ttl: NOW_EPOCH + 3600,
  };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    messageId: 'msg-1',
    body: JSON.stringify({
      eventId: 'demo-2026',
      registrationId: '11111111-1111-4111-8111-111111111111',
      ...overrides,
    }),
  };
}

describe('registrationBackfill', () => {
  it('matches every already-uploaded photo for a newly enrolled registration', async () => {
    dynamoMock.on(GetCommand).resolves({ Item: enrolledRegistration() });
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'EVENT#demo-2026',
          SK: 'PHOTO#photo-a',
          photoId: 'photo-a',
          s3Key: 'events/demo-2026/photos/photo-a.jpg',
          ttl: NOW_EPOCH + 3600,
        },
        {
          PK: 'EVENT#demo-2026',
          SK: 'PHOTO#photo-b',
          photoId: 'photo-b',
          s3Key: 'events/demo-2026/photos/photo-b.jpg',
          ttl: NOW_EPOCH + 3600,
        },
      ],
    });

    const result = await registrationBackfill({ Records: [job()] });

    expect(result.batchItemFailures).toEqual([]);
    expect(matchPhotoMock).toHaveBeenCalledTimes(2);
    expect(matchPhotoMock).toHaveBeenNthCalledWith(
      1,
      'findly-local-photos',
      'demo-2026',
      'photo-a',
      'events/demo-2026/photos/photo-a.jpg',
      expect.any(Function),
    );
    expect(matchPhotoMock).toHaveBeenNthCalledWith(
      2,
      'findly-local-photos',
      'demo-2026',
      'photo-b',
      'events/demo-2026/photos/photo-b.jpg',
      expect.any(Function),
    );
    expect(sqsMock.calls()).toHaveLength(0);
  });

  it('requeues a continuation message carrying the DynamoDB cursor when more photos remain', async () => {
    dynamoMock.on(GetCommand).resolves({ Item: enrolledRegistration() });
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'EVENT#demo-2026',
          SK: 'PHOTO#photo-a',
          photoId: 'photo-a',
          s3Key: 'events/demo-2026/photos/photo-a.jpg',
          ttl: NOW_EPOCH + 3600,
        },
      ],
      LastEvaluatedKey: { PK: 'EVENT#demo-2026', SK: 'PHOTO#photo-a' },
    });

    await registrationBackfill({ Records: [job()] });

    const sent = sqsMock.commandCalls(SendMessageCommand);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.args[0].input.QueueUrl).toBe(
      'https://sqs.test/backfill-queue',
    );
    expect(JSON.parse(sent[0]!.args[0].input.MessageBody as string)).toEqual({
      eventId: 'demo-2026',
      registrationId: '11111111-1111-4111-8111-111111111111',
      cursor: { PK: 'EVENT#demo-2026', SK: 'PHOTO#photo-a' },
    });
  });

  it.each([
    ['FAILED status', { status: 'FAILED' }],
    ['no faceId', { faceId: undefined }],
    ['revoked (erasureRequestedAt present)', { erasureRequestedAt: 'now' }],
    ['expired ttl', { ttl: NOW_EPOCH - 1 }],
  ])(
    'does no work when the triggering registration is no longer eligible (%s)',
    async (_label, overrides) => {
      dynamoMock
        .on(GetCommand)
        .resolves({ Item: { ...enrolledRegistration(), ...overrides } });

      const result = await registrationBackfill({ Records: [job()] });

      expect(result.batchItemFailures).toEqual([]);
      expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
      expect(matchPhotoMock).not.toHaveBeenCalled();
    },
  );

  it('does no work when the triggering registration has been deleted', async () => {
    dynamoMock.on(GetCommand).resolves({ Item: undefined });

    const result = await registrationBackfill({ Records: [job()] });

    expect(result.batchItemFailures).toEqual([]);
    expect(matchPhotoMock).not.toHaveBeenCalled();
  });

  it('skips a photo whose own ttl has already elapsed without matching it', async () => {
    dynamoMock.on(GetCommand).resolves({ Item: enrolledRegistration() });
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'EVENT#demo-2026',
          SK: 'PHOTO#photo-expired',
          photoId: 'photo-expired',
          s3Key: 'events/demo-2026/photos/photo-expired.jpg',
          ttl: NOW_EPOCH - 1,
        },
        {
          PK: 'EVENT#demo-2026',
          SK: 'PHOTO#photo-live',
          photoId: 'photo-live',
          s3Key: 'events/demo-2026/photos/photo-live.jpg',
          ttl: NOW_EPOCH + 3600,
        },
      ],
    });

    await registrationBackfill({ Records: [job()] });

    expect(matchPhotoMock).toHaveBeenCalledTimes(1);
    expect(matchPhotoMock).toHaveBeenCalledWith(
      'findly-local-photos',
      'demo-2026',
      'photo-live',
      'events/demo-2026/photos/photo-live.jpg',
      expect.any(Function),
    );
  });

  it('reports a batch item failure without losing other records when matchPhoto throws', async () => {
    dynamoMock.on(GetCommand).resolves({ Item: enrolledRegistration() });
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'EVENT#demo-2026',
          SK: 'PHOTO#photo-a',
          photoId: 'photo-a',
          s3Key: 'events/demo-2026/photos/photo-a.jpg',
          ttl: NOW_EPOCH + 3600,
        },
      ],
    });
    const failure = Object.assign(new Error('throttled'), {
      name: 'ThrottlingException',
    });
    matchPhotoMock.mockRejectedValueOnce(failure);

    const result = await registrationBackfill({
      Records: [
        job({ registrationId: '22222222-2222-4222-8222-222222222222' }),
        job(),
      ],
    });

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }]);
  });

  it('drops a malformed message instead of retrying it forever', async () => {
    const result = await registrationBackfill({
      Records: [{ messageId: 'msg-bad', body: '{"eventId": 123}' }],
    });

    expect(result.batchItemFailures).toEqual([]);
    expect(matchPhotoMock).not.toHaveBeenCalled();
    expect(dynamoMock.commandCalls(GetCommand)).toHaveLength(0);
  });

  it('fails the record instead of silently stalling when the queue URL is unset', async () => {
    delete process.env.FINDLY_BACKFILL_QUEUE_URL;
    dynamoMock.on(GetCommand).resolves({ Item: enrolledRegistration() });
    dynamoMock.on(QueryCommand).resolves({
      Items: [],
      LastEvaluatedKey: { PK: 'EVENT#demo-2026', SK: 'PHOTO#photo-a' },
    });

    const result = await registrationBackfill({ Records: [job()] });

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }]);
  });

  describe('structured logging', () => {
    let logs: ReturnType<typeof captureLogs>;
    beforeEach(() => {
      logs = captureLogs();
    });
    afterEach(() => logs.restore());

    it('never logs the registrationId, only the eventId and a photo count', async () => {
      dynamoMock.on(GetCommand).resolves({ Item: enrolledRegistration() });
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            PK: 'EVENT#demo-2026',
            SK: 'PHOTO#photo-a',
            photoId: 'photo-a',
            s3Key: 'events/demo-2026/photos/photo-a.jpg',
            ttl: NOW_EPOCH + 3600,
          },
        ],
      });

      await registrationBackfill(
        { Records: [job()] },
        { awsRequestId: 'lambda-req-1' },
      );

      for (const line of logs.lines)
        expect(line).not.toContain('11111111-1111-4111-8111-111111111111');
      expect(logs.records()).toEqual([
        expect.objectContaining({
          level: 'INFO',
          event: 'registration_backfill_processed',
          eventId: 'demo-2026',
          photoCount: 1,
        }),
        expect.objectContaining({
          level: 'INFO',
          event: 'registration_backfill_batch_processed',
          correlationId: 'lambda-req-1',
          recordCount: 1,
          failedCount: 0,
        }),
      ]);
    });
  });
});
