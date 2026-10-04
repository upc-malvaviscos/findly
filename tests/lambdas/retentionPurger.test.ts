import {
  DeleteCollectionCommand,
  DeleteFacesCommand,
  ListFacesCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import {
  DeleteObjectsCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  DeleteCommand,
  GetCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retentionPurger } from '../../src/lambdas/retentionPurger';
import { captureLogs } from './lib/logCapture';

const dynamoMock = mockClient(DynamoDBDocumentClient);
const rekognitionMock = mockClient(RekognitionClient);
const s3Mock = mockClient(S3Client);

beforeEach(() => dynamoMock.on(UpdateCommand).resolves({}));

afterEach(() => {
  dynamoMock.reset();
  rekognitionMock.reset();
  s3Mock.reset();
  vi.unstubAllEnvs();
});

const oldEnoughDate = new Date(
  Date.now() - 40 * 24 * 60 * 60 * 1000,
).toISOString();
beforeEach(() => {
  dynamoMock.on(QueryCommand).resolves({ Items: [] });
  dynamoMock.on(DeleteCommand).resolves({});
  rekognitionMock.on(ListFacesCommand).resolves({ Faces: [] });
  rekognitionMock.on(DeleteFacesCommand).resolves({});
  s3Mock.on(DeleteObjectCommand).resolves({});
});

const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

function mockEmptyEmailState() {
  for (const prefix of ['TOKEN#', 'EMAIL#'])
    dynamoMock
      .on(QueryCommand, { ExpressionAttributeValues: { ':prefix': prefix } })
      .resolves({ Items: [] });
}
describe('retentionPurger lambda', () => {
  it('purges nothing when no events are expired', async () => {
    dynamoMock.on(QueryCommand, { IndexName: 'GSI2' }).resolves({
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
    dynamoMock.on(QueryCommand, { IndexName: 'GSI2' }).resolves({
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
    dynamoMock.on(QueryCommand, { IndexName: 'GSI2' }).resolves({
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
    dynamoMock.on(QueryCommand, { IndexName: 'GSI2' }).resolves({
      Items: [{ eventId: 'evt-incomplete' }],
    });

    const result = await retentionPurger();

    expect(result.expiredEvents).toBe(0);
  });

  it('pages through a Query with more than one page of results', async () => {
    dynamoMock
      .on(QueryCommand, { IndexName: 'GSI2' })
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
    expect(
      dynamoMock.commandCalls(QueryCommand, { IndexName: 'GSI2' }),
    ).toHaveLength(2);
  });

  it('does not report a purge complete when S3 returns per-object failures', async () => {
    dynamoMock.on(QueryCommand, { IndexName: 'GSI2' }).resolves({
      Items: [
        {
          eventId: 'evt-expired',
          createdAt: oldEnoughDate,
          retentionDays: 30,
        },
      ],
    });
    rekognitionMock.on(DeleteCollectionCommand).resolves({});
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: 'events/evt-expired/selfies/reg-1.jpg' }],
    });
    s3Mock.on(DeleteObjectsCommand).resolves({
      Errors: [
        { Key: 'events/evt-expired/selfies/reg-1.jpg', Code: 'AccessDenied' },
      ],
    });
    await expect(retentionPurger()).rejects.toThrow('ObjectDeletionFailed');
  });

  it('purges linked records before metadata, paginating matches and preserving legacy TTL', async () => {
    dynamoMock.on(QueryCommand, { IndexName: 'GSI2' }).resolves({
      Items: [
        {
          eventId: 'evt-expired',
          createdAt: oldEnoughDate,
          retentionDays: 30,
        },
      ],
    });
    dynamoMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': 'EVENT#evt-expired' },
      })
      .resolves({
        Items: [
          { PK: 'EVENT#evt-expired', SK: 'METADATA' },
          {
            PK: 'EVENT#evt-expired',
            SK: 'REG#reg-new',
            registrationId: 'reg-new',
            tokenHash: 'hash-new',
          },
          {
            PK: 'EVENT#evt-expired',
            SK: 'REG#reg-legacy',
            registrationId: 'reg-legacy',
          },
        ],
      });
    dynamoMock
      .on(QueryCommand, { ExpressionAttributeValues: { ':pk': 'REG#reg-new' } })
      .callsFake((input) =>
        input.ExclusiveStartKey
          ? { Items: [{ PK: 'REG#reg-new', SK: 'MATCH#2' }] }
          : {
              Items: [{ PK: 'REG#reg-new', SK: 'MATCH#1' }],
              LastEvaluatedKey: { PK: 'REG#reg-new', SK: 'MATCH#1' },
            },
      );
    rekognitionMock.on(DeleteCollectionCommand).resolves({});
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    mockEmptyEmailState();
    await retentionPurger();
    const keys = dynamoMock
      .commandCalls(DeleteCommand)
      .map((call) => call.args[0].input.Key);
    expect(keys).toContainEqual({ PK: 'REG#reg-new', SK: 'MATCH#2' });
    expect(keys).toContainEqual({ PK: 'TOKEN#hash-new', SK: 'METADATA' });
    expect(keys.at(-1)).toEqual({ PK: 'EVENT#evt-expired', SK: 'METADATA' });
  });

  it('retains metadata when a database deletion fails so the next run retries', async () => {
    dynamoMock.on(QueryCommand, { IndexName: 'GSI2' }).resolves({
      Items: [
        {
          eventId: 'evt-expired',
          createdAt: oldEnoughDate,
          retentionDays: 30,
        },
      ],
    });
    dynamoMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': 'EVENT#evt-expired' },
      })
      .resolves({
        Items: [
          {
            PK: 'EVENT#evt-expired',
            SK: 'REG#reg-1',
            registrationId: 'reg-1',
            tokenHash: 'hash-1',
          },
        ],
      });
    dynamoMock.on(DeleteCommand).rejects(new Error('temporary write failure'));
    rekognitionMock.on(DeleteCollectionCommand).resolves({});
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    await expect(retentionPurger()).rejects.toThrow('temporary write failure');
    expect(
      dynamoMock
        .commandCalls(DeleteCommand)
        .map((call) => call.args[0].input.Key),
    ).not.toContainEqual({ PK: 'EVENT#evt-expired', SK: 'METADATA' });
  });

  it('purges locator-linked MATCH and TOKEN even when REG expired first', async () => {
    const locator = {
      PK: 'EVENT#evt-expired',
      SK: 'RETENTION#reg-1',
      eventId: 'evt-expired',
      registrationId: 'reg-1',
      tokenHash: 'hash-1',
      selfieS3Key: 'events/evt-expired/selfies/reg-1.selfie.jpg',
      cleanupAfter: 1,
    };
    dynamoMock.on(QueryCommand, { IndexName: 'GSI2' }).resolves({
      Items: [
        {
          eventId: 'evt-expired',
          createdAt: oldEnoughDate,
          retentionDays: 30,
        },
      ],
    });
    dynamoMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': 'EVENT#evt-expired' },
      })
      .resolves({ Items: [locator] });
    dynamoMock
      .on(QueryCommand, { ExpressionAttributeValues: { ':pk': 'REG#reg-1' } })
      .resolves({ Items: [{ PK: 'REG#reg-1', SK: 'MATCH#1' }] });
    rekognitionMock.on(DeleteCollectionCommand).resolves({});
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    expect((await retentionPurger()).expiredEvents).toBe(1);
    const keys = dynamoMock
      .commandCalls(DeleteCommand)
      .map((call) => call.args[0].input.Key);
    expect(keys).toContainEqual({ PK: 'REG#reg-1', SK: 'MATCH#1' });
    expect(keys).toContainEqual({ PK: 'TOKEN#hash-1', SK: 'METADATA' });
    expect(keys.at(-1)).toEqual({ PK: 'EVENT#evt-expired', SK: 'METADATA' });
  });

  it('keeps locator and event retry marker until the upload/async barrier closes', async () => {
    const locator = {
      PK: 'EVENT#evt-expired',
      SK: 'RETENTION#reg-1',
      eventId: 'evt-expired',
      registrationId: 'reg-1',
      selfieS3Key: 'events/evt-expired/selfies/reg-1.selfie.jpg',
      cleanupAfter: Math.floor(Date.now() / 1000) + 1000,
    };
    dynamoMock.on(QueryCommand, { IndexName: 'GSI2' }).resolves({
      Items: [
        {
          eventId: 'evt-expired',
          createdAt: oldEnoughDate,
          retentionDays: 30,
        },
      ],
    });
    dynamoMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': 'EVENT#evt-expired' },
      })
      .resolves({ Items: [locator] });
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    expect((await retentionPurger()).expiredEvents).toBe(0);
    expect(
      dynamoMock
        .commandCalls(DeleteCommand)
        .map((call) => call.args[0].input.Key),
    ).not.toContainEqual({ PK: locator.PK, SK: locator.SK });
    expect(rekognitionMock.commandCalls(DeleteCollectionCommand)).toHaveLength(
      0,
    );
  });

  it('reconciles late faces and selfies for erased registrations on active events', async () => {
    const locator = {
      PK: 'EVENT#evt-active',
      SK: 'RETENTION#reg-1',
      eventId: 'evt-active',
      registrationId: 'reg-1',
      tokenHash: 'hash-active',
      selfieS3Key: 'events/evt-active/selfies/reg-1.selfie.jpg',
      erasureRequestedAt: recentDate,
      cleanupState: 'CLEANED',
    };
    dynamoMock.on(QueryCommand, { IndexName: 'GSI2' }).resolves({
      Items: [
        { eventId: 'evt-active', createdAt: recentDate, retentionDays: 30 },
      ],
    });
    dynamoMock
      .on(QueryCommand, {
        ExpressionAttributeValues: {
          ':pk': 'EVENT#evt-active',
          ':locators': 'RETENTION#',
        },
      })
      .resolves({ Items: [locator] });
    dynamoMock
      .on(QueryCommand, { ExpressionAttributeValues: { ':pk': 'REG#reg-1' } })
      .resolves({ Items: [{ PK: 'REG#reg-1', SK: 'MATCH#pending' }] });
    rekognitionMock.on(ListFacesCommand).resolves({
      Faces: [
        { FaceId: 'late-face', ExternalImageId: 'reg-1' },
        { FaceId: 'unrelated', ExternalImageId: 'reg-other' },
      ],
    });
    expect((await retentionPurger()).expiredEvents).toBe(0);
    expect(
      rekognitionMock.commandCalls(DeleteFacesCommand)[0]?.args[0].input
        .FaceIds,
    ).toEqual(['late-face']);
    const deletedKeys = dynamoMock
      .commandCalls(DeleteCommand)
      .map((call) => call.args[0].input.Key);
    expect(deletedKeys).toContainEqual({
      PK: 'REG#reg-1',
      SK: 'MATCH#pending',
    });
    expect(deletedKeys).toContainEqual({
      PK: 'TOKEN#hash-active',
      SK: 'METADATA',
    });
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(2);
    expect(
      dynamoMock
        .commandCalls(DeleteCommand)
        .map((call) => call.args[0].input.Key),
    ).not.toContainEqual({ PK: locator.PK, SK: locator.SK });
  });

  it('keeps metadata and collection for an expired event with outstanding photo PUTs and no registrations', async () => {
    dynamoMock.on(QueryCommand, { IndexName: 'GSI2' }).resolves({
      Items: [
        {
          eventId: 'evt-just-expired',
          createdAt: new Date(Date.now() - 86400000 - 1000).toISOString(),
          retentionDays: 1,
        },
      ],
    });
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    expect((await retentionPurger()).expiredEvents).toBe(0);
    expect(dynamoMock.commandCalls(DeleteCommand)).toHaveLength(0);
    expect(rekognitionMock.commandCalls(DeleteCollectionCommand)).toHaveLength(
      0,
    );
    expect(
      dynamoMock.commandCalls(UpdateCommand)[0]?.args[0].input
        .ExpressionAttributeValues?.[':after'],
    ).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('refuses to purge legacy facial data whose collection origin is unknown', async () => {
    vi.stubEnv('FINDLY_COLLECTION_NAMESPACE', 'findly-pr-71');
    dynamoMock.on(QueryCommand, { IndexName: 'GSI2' }).resolves({
      Items: [
        {
          eventId: 'evt-legacy',
          createdAt: oldEnoughDate,
          retentionDays: 30,
        },
      ],
    });
    dynamoMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': 'EVENT#evt-legacy' },
      })
      .resolves({
        Items: [
          {
            PK: 'EVENT#evt-legacy',
            SK: 'REG#reg-1',
            registrationId: 'reg-1',
            faceId: 'legacy-face',
          },
        ],
      });
    dynamoMock.on(GetCommand).resolves({});
    await expect(retentionPurger()).rejects.toThrow(
      'LegacyFaceCollectionMigrationRequired',
    );
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
    expect(dynamoMock.commandCalls(DeleteCommand)).toHaveLength(0);
    expect(rekognitionMock.commandCalls(DeleteCollectionCommand)).toHaveLength(
      0,
    );
  });

  it('pages through S3 objects across more than one ListObjectsV2 page', async () => {
    dynamoMock.on(QueryCommand, { IndexName: 'GSI2' }).resolves({
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
    dynamoMock.on(QueryCommand, { IndexName: 'GSI2' }).resolves({
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
    dynamoMock.on(QueryCommand, { IndexName: 'GSI2' }).resolves({
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
