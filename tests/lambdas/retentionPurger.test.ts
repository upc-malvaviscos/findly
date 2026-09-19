import {
  DeleteCollectionCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { retentionPurger } from '../../src/lambdas/retentionPurger';
import { captureLogs } from './lib/logCapture';

const dynamoMock = mockClient(DynamoDBDocumentClient);
const rekognitionMock = mockClient(RekognitionClient);
const s3Mock = mockClient(S3Client);

afterEach(() => {
  dynamoMock.reset();
  rekognitionMock.reset();
  s3Mock.reset();
});

const oldEnoughDate = new Date(
  Date.now() - 40 * 24 * 60 * 60 * 1000,
).toISOString();
const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

describe('retentionPurger lambda', () => {
  it('purges nothing when no events are expired', async () => {
    dynamoMock.on(ScanCommand).resolves({
      Items: [
        { eventId: 'evt-recent', createdAt: recentDate, retentionDays: 30 },
      ],
    });

    const result = await retentionPurger();

    expect(result.expiredEvents).toBe(0);
    expect(rekognitionMock.commandCalls(DeleteCollectionCommand)).toHaveLength(
      0,
    );
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
  });

  it('purges the Rekognition collection and S3 objects for an expired event', async () => {
    dynamoMock.on(ScanCommand).resolves({
      Items: [
        { eventId: 'evt-expired', createdAt: oldEnoughDate, retentionDays: 30 },
      ],
    });
    rekognitionMock.on(DeleteCollectionCommand).resolves({});
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: 'events/evt-expired/selfies/reg-1.jpg' },
        { Key: 'events/evt-expired/photos/photo-1.jpg' },
      ],
    });
    s3Mock.on(DeleteObjectsCommand).resolves({});

    const result = await retentionPurger();

    expect(result.expiredEvents).toBe(1);
    const collectionCalls = rekognitionMock.commandCalls(
      DeleteCollectionCommand,
    );
    expect(collectionCalls[0]?.args[0].input.CollectionId).toBe(
      'findly-event-evt-expired',
    );
    const deleteCalls = s3Mock.commandCalls(DeleteObjectsCommand);
    expect(deleteCalls[0]?.args[0].input.Delete?.Objects).toEqual([
      { Key: 'events/evt-expired/selfies/reg-1.jpg' },
      { Key: 'events/evt-expired/photos/photo-1.jpg' },
    ]);
  });

  it('treats an already-deleted collection as success, not an error', async () => {
    dynamoMock.on(ScanCommand).resolves({
      Items: [
        { eventId: 'evt-expired', createdAt: oldEnoughDate, retentionDays: 30 },
      ],
    });
    const missing = new Error('not found');
    missing.name = 'ResourceNotFoundException';
    rekognitionMock.on(DeleteCollectionCommand).rejects(missing);
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });

    const result = await retentionPurger();

    expect(result.expiredEvents).toBe(1);
  });

  it('skips events missing createdAt or retentionDays without throwing', async () => {
    dynamoMock.on(ScanCommand).resolves({
      Items: [{ eventId: 'evt-incomplete' }],
    });

    const result = await retentionPurger();

    expect(result.expiredEvents).toBe(0);
  });

  it('pages through a Scan with more than one page of results', async () => {
    dynamoMock
      .on(ScanCommand)
      .resolvesOnce({
        Items: [
          { eventId: 'evt-a', createdAt: oldEnoughDate, retentionDays: 30 },
        ],
        LastEvaluatedKey: { PK: 'EVENT#evt-a', SK: 'METADATA' },
      })
      .resolvesOnce({
        Items: [
          { eventId: 'evt-b', createdAt: oldEnoughDate, retentionDays: 30 },
        ],
      });
    rekognitionMock.on(DeleteCollectionCommand).resolves({});
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });

    const result = await retentionPurger();

    expect(result.expiredEvents).toBe(2);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(2);
  });

  it('pages through S3 objects across more than one ListObjectsV2 page', async () => {
    dynamoMock.on(ScanCommand).resolves({
      Items: [
        { eventId: 'evt-expired', createdAt: oldEnoughDate, retentionDays: 30 },
      ],
    });
    rekognitionMock.on(DeleteCollectionCommand).resolves({});
    s3Mock
      .on(ListObjectsV2Command)
      .resolvesOnce({
        Contents: [{ Key: 'events/evt-expired/selfies/reg-1.jpg' }],
        NextContinuationToken: 'token-1',
      })
      .resolvesOnce({
        Contents: [{ Key: 'events/evt-expired/photos/photo-1.jpg' }],
      });
    s3Mock.on(DeleteObjectsCommand).resolves({});

    const result = await retentionPurger();

    expect(result.expiredEvents).toBe(1);
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(2);
    expect(s3Mock.commandCalls(DeleteObjectsCommand)).toHaveLength(2);
  });
});

describe('retentionPurger structured logging', () => {
  let logs: ReturnType<typeof captureLogs>;
  beforeEach(() => {
    logs = captureLogs();
  });
  afterEach(() => logs.restore());

  it('logs each purged event and a completion summary under one correlation ID', async () => {
    dynamoMock.on(ScanCommand).resolves({
      Items: [
        { eventId: 'evt-expired', createdAt: oldEnoughDate, retentionDays: 30 },
      ],
    });
    rekognitionMock.on(DeleteCollectionCommand).resolves({});
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });

    await retentionPurger({}, { awsRequestId: 'lambda-req-1' });

    expect(logs.records()).toEqual([
      {
        level: 'INFO',
        event: 'event_retention_purged',
        correlationId: 'lambda-req-1',
        eventId: 'evt-expired',
      },
      expect.objectContaining({
        level: 'INFO',
        event: 'retention_purge_completed',
        correlationId: 'lambda-req-1',
        expiredEvents: 1,
      }),
    ]);
  });

  it('logs an ERROR with the events purged so far, then rethrows', async () => {
    dynamoMock.on(ScanCommand).resolves({
      Items: [
        { eventId: 'evt-a', createdAt: oldEnoughDate, retentionDays: 30 },
        { eventId: 'evt-b', createdAt: oldEnoughDate, retentionDays: 30 },
      ],
    });
    rekognitionMock
      .on(DeleteCollectionCommand, { CollectionId: 'findly-event-evt-a' })
      .resolves({});
    const failure = new Error('bucket findly-secret denied');
    failure.name = 'AccessDenied';
    rekognitionMock
      .on(DeleteCollectionCommand, { CollectionId: 'findly-event-evt-b' })
      .rejects(failure);
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });

    await expect(retentionPurger()).rejects.toBe(failure);

    const failed = logs
      .records()
      .find((record) => record.event === 'retention_purge_failed');
    expect(failed).toMatchObject({
      level: 'ERROR',
      purgedEvents: 1,
      errorName: 'AccessDenied',
    });
    expect(logs.lines.join('')).not.toContain('findly-secret');
  });
});
