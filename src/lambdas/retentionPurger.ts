import { eraseEmailState } from './lib/emailCleanup';
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
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  GetCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  eventKey,
  galleryTokenKey,
  registrationKey,
  registrationPartitionKey,
  EVENT_LISTING_GSI2_PARTITION_KEY,
} from '../shared/lib/dynamoKeys';
import {
  cleanupDeadline,
  isRetentionLocator,
  retentionLocatorKey,
  type RetentionLocatorEntity,
} from '../shared/lib/retentionCleanup';
import { eventCollectionId } from '../shared/lib/rekognitionCollections';
import { isMissingResourceError } from './lib/awsErrors';
import {
  emitLog,
  errorNameOf,
  resolveCorrelationId,
  type LambdaContextLike,
} from './lib/logger';
import type { EventEntity } from '../shared/types/entities';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const S3_DELETE_BATCH_SIZE = 1000;

const tableName = process.env.FINDLY_TABLE_NAME ?? 'findly-local';
const uploadsBucket =
  process.env.FINDLY_UPLOADS_BUCKET ?? 'findly-local-uploads';
const endpoint = process.env.AWS_ENDPOINT_URL;
const clientOptions = endpoint
  ? { endpoint, region: 'eu-west-1' }
  : { region: 'eu-west-1' };
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(clientOptions));
const s3 = new S3Client({
  ...clientOptions,
  forcePathStyle: Boolean(endpoint),
});
const rekognition = new RekognitionClient(clientOptions);

export type RetentionPurgerResult = {
  expiredEvents: number;
};

type ExpiredEvent = Pick<
  EventEntity,
  'eventId' | 'createdAt' | 'retentionDays'
> & { cleanupAfter?: number };

function isExpired(event: Partial<EventEntity>, now: number): boolean {
  if (!event.eventId || !event.createdAt || event.retentionDays === undefined)
    return false;
  const expiresAt =
    Date.parse(event.createdAt) + event.retentionDays * MILLISECONDS_PER_DAY;
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

async function findEvents(): Promise<ExpiredEvent[]> {
  const expired: ExpiredEvent[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :events',
        ExpressionAttributeValues: {
          ':events': EVENT_LISTING_GSI2_PARTITION_KEY,
        },
        ProjectionExpression: 'eventId, createdAt, retentionDays, cleanupAfter',
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const item of (page.Items ?? []) as Partial<EventEntity>[])
      if (item.eventId && item.createdAt && item.retentionDays !== undefined)
        expired.push(item as ExpiredEvent);
    exclusiveStartKey = page.LastEvaluatedKey as
      Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return expired;
}

async function deleteEventCollection(eventId: string): Promise<void> {
  try {
    await rekognition.send(
      new DeleteCollectionCommand({ CollectionId: eventCollectionId(eventId) }),
    );
  } catch (err) {
    if (!isMissingResourceError(err)) throw err;
  }
}

async function deleteEventObjects(eventId: string): Promise<void> {
  const prefix = `events/${eventId}/`;
  let continuationToken: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: uploadsBucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const keys = (page.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => Boolean(key));
    for (let start = 0; start < keys.length; start += S3_DELETE_BATCH_SIZE) {
      const batch = keys.slice(start, start + S3_DELETE_BATCH_SIZE);
      const deleted = await s3.send(
        new DeleteObjectsCommand({
          Bucket: uploadsBucket,
          Delete: { Objects: batch.map((Key) => ({ Key })) },
        }),
      );
      if (deleted.Errors?.length) throw new Error('ObjectDeletionFailed');
    }
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
}

async function deleteEventRecords(eventId: string): Promise<boolean> {
  let blocked = false;
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': eventKey(eventId).PK },
        ConsistentRead: true,
        ExclusiveStartKey: cursor,
      }),
    );
    for (const item of page.Items ?? []) {
      if (item.SK === 'METADATA') continue;
      if (typeof item.registrationId === 'string') {
        try {
          await dynamo.send(
            new UpdateCommand({
              TableName: tableName,
              Key: { PK: item.PK, SK: item.SK },
              UpdateExpression:
                'SET erasureRequestedAt = if_not_exists(erasureRequestedAt, :now)',
              ExpressionAttributeValues: { ':now': new Date().toISOString() },
              ConditionExpression: 'attribute_exists(PK)',
            }),
          );
        } catch (markError) {
          if (
            (markError as { name?: string }).name !==
            'ConditionalCheckFailedException'
          )
            throw markError;
        }
        await eraseEmailState(dynamo, tableName, item.registrationId);
        let matchCursor: Record<string, unknown> | undefined;
        do {
          const matches = await dynamo.send(
            new QueryCommand({
              TableName: tableName,
              KeyConditionExpression: 'PK = :pk',
              ExpressionAttributeValues: {
                ':pk': registrationPartitionKey(item.registrationId),
              },
              ConsistentRead: true,
              ExclusiveStartKey: matchCursor,
            }),
          );
          for (const match of matches.Items ?? []) {
            await dynamo.send(
              new DeleteCommand({
                TableName: tableName,
                Key: { PK: match.PK, SK: match.SK },
              }),
            );
          }
          matchCursor = matches.LastEvaluatedKey;
        } while (matchCursor);
        // Legacy registrations have no inverse token reference; those tokens
        // remain governed by their existing TTL until their expiry.
        if (typeof item.tokenHash === 'string') {
          await dynamo.send(
            new DeleteCommand({
              TableName: tableName,
              Key: galleryTokenKey(item.tokenHash),
            }),
          );
        }
      }
      if (isRetentionLocator(item)) {
        await reconcileErasedLocator(item);
        const after =
          item.cleanupAfter ?? cleanupDeadline(item.uploadExpiresAt);
        if (after > Math.floor(Date.now() / 1000)) {
          blocked = true;
          await dynamo.send(
            new UpdateCommand({
              TableName: tableName,
              Key: { PK: item.PK, SK: item.SK },
              UpdateExpression:
                'SET cleanupState = :state, erasureRequestedAt = if_not_exists(erasureRequestedAt, :now), cleanupAfter = :after REMOVE faceIds, tokenHash',
              ExpressionAttributeValues: {
                ':state': 'CLEANED',
                ':now': new Date().toISOString(),
                ':after': after,
              },
            }),
          );
          continue;
        }
      }
      await dynamo.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { PK: item.PK, SK: item.SK },
        }),
      );
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return !blocked;
}

async function reconcileErasedLocator(
  locator: RetentionLocatorEntity,
): Promise<void> {
  const { eventId, registrationId } = locator;
  if (
    process.env.FINDLY_COLLECTION_NAMESPACE &&
    locator.collectionId !== eventCollectionId(eventId)
  )
    throw new Error('LegacyFaceCollectionMigrationRequired');
  const legacyKey = `events/${eventId}/selfies/${registrationId}.jpg`;
  const currentKey = `events/${eventId}/selfies/${registrationId}.selfie.jpg`;
  if (locator.selfieS3Key !== legacyKey && locator.selfieS3Key !== currentKey)
    throw new Error('InvalidRegistrationSelfieKey');
  const faces = new Set(locator.faceIds ?? []);
  let nextToken: string | undefined;
  try {
    do {
      const page = await rekognition.send(
        new ListFacesCommand({
          CollectionId: eventCollectionId(eventId),
          NextToken: nextToken,
          MaxResults: 4096,
        }),
      );
      for (const face of page.Faces ?? [])
        if (face.ExternalImageId === registrationId && face.FaceId)
          faces.add(face.FaceId);
      nextToken = page.NextToken;
    } while (nextToken);
  } catch (error) {
    if (!isMissingResourceError(error)) throw error;
  }
  if (faces.size)
    await dynamo.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: locator.PK, SK: locator.SK },
        UpdateExpression: 'ADD faceIds :faces',
        ExpressionAttributeValues: { ':faces': faces },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  for (const faceId of faces) {
    try {
      const deleted = await rekognition.send(
        new DeleteFacesCommand({
          CollectionId: eventCollectionId(eventId),
          FaceIds: [faceId],
        }),
      );
      if (
        deleted.UnsuccessfulFaceDeletions?.some(
          (face) =>
            !face.Reasons?.length ||
            face.Reasons.some((reason) => reason !== 'FACE_NOT_FOUND'),
        )
      )
        throw new Error('FaceDeletionFailed');
    } catch (error) {
      if (!isMissingResourceError(error)) throw error;
    }
  }
  for (const Key of [legacyKey, currentKey])
    await s3.send(new DeleteObjectCommand({ Bucket: uploadsBucket, Key }));
  await eraseEmailState(dynamo, tableName, registrationId);
  let matchCursor: Record<string, unknown> | undefined;
  do {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': registrationPartitionKey(registrationId),
        },
        ConsistentRead: true,
        ExclusiveStartKey: matchCursor,
      }),
    );
    for (const item of page.Items ?? [])
      await dynamo.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { PK: item.PK, SK: item.SK },
        }),
      );
    matchCursor = page.LastEvaluatedKey;
  } while (matchCursor);
  if (locator.tokenHash)
    await dynamo.send(
      new DeleteCommand({
        TableName: tableName,
        Key: galleryTokenKey(locator.tokenHash),
      }),
    );
  await dynamo.send(
    new DeleteCommand({
      TableName: tableName,
      Key: registrationKey(eventId, registrationId),
    }),
  );
  await dynamo.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: locator.PK, SK: locator.SK },
      UpdateExpression:
        'SET cleanupState = :state, cleanupCompletedAt = :now REMOVE faceIds, tokenHash',
      ExpressionAttributeValues: {
        ':state': 'CLEANED',
        ':now': new Date().toISOString(),
      },
      ConditionExpression: 'attribute_exists(PK)',
    }),
  );
}

async function reconcileActiveEvent(eventId: string): Promise<void> {
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :locators)',
        ExpressionAttributeValues: {
          ':pk': eventKey(eventId).PK,
          ':locators': 'RETENTION#',
        },
        ConsistentRead: true,
        ExclusiveStartKey: cursor,
      }),
    );
    for (const item of page.Items ?? []) {
      if (isRetentionLocator(item) && item.erasureRequestedAt)
        await reconcileErasedLocator(item);
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
}

async function assertEventCollectionOrigin(eventId: string): Promise<void> {
  if (!process.env.FINDLY_COLLECTION_NAMESPACE) return;
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': eventKey(eventId).PK },
        ConsistentRead: true,
        ExclusiveStartKey: cursor,
      }),
    );
    const locators = new Map(
      (page.Items ?? [])
        .filter(isRetentionLocator)
        .map((item) => [item.registrationId, item]),
    );
    for (const item of page.Items ?? []) {
      if (isRetentionLocator(item)) {
        if (item.collectionId !== eventCollectionId(eventId))
          throw new Error('LegacyFaceCollectionMigrationRequired');
        continue;
      }
      if (
        typeof item.faceId === 'string' &&
        !locators.has(item.registrationId)
      ) {
        // The locator may be on another Query page: fetch its exact key.
        const found = (
          await dynamo.send(
            new GetCommand({
              TableName: tableName,
              Key: retentionLocatorKey(eventId, item.registrationId),
              ConsistentRead: true,
            }),
          )
        ).Item;
        if (
          !isRetentionLocator(found) ||
          found.collectionId !== eventCollectionId(eventId)
        )
          throw new Error('LegacyFaceCollectionMigrationRequired');
      }
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
}

export async function retentionPurger(
  _event?: unknown,
  context?: LambdaContextLike,
): Promise<RetentionPurgerResult> {
  const startedAt = Date.now();
  const correlationId = resolveCorrelationId(context?.awsRequestId);
  let purged = 0;

  try {
    const events = await findEvents();

    for (const event of events) {
      if (!isExpired(event, Date.now())) {
        await reconcileActiveEvent(event.eventId);
        continue;
      }
      const eventDeadline = Math.max(
        event.cleanupAfter ?? 0,
        Math.floor(
          (Date.parse(event.createdAt) +
            event.retentionDays * MILLISECONDS_PER_DAY) /
            1000,
        ) +
          300 +
          6 * 60 * 60 +
          30,
      );
      try {
        await dynamo.send(
          new UpdateCommand({
            TableName: tableName,
            Key: eventKey(event.eventId),
            UpdateExpression: 'SET cleanupAfter = :after',
            ExpressionAttributeValues: { ':after': eventDeadline },
            ConditionExpression:
              'attribute_exists(PK) AND (attribute_not_exists(cleanupAfter) OR cleanupAfter <= :after)',
          }),
        );
      } catch (markerError) {
        if (
          (markerError as { name?: string }).name ===
          'ConditionalCheckFailedException'
        )
          continue;
        throw markerError;
      }
      await assertEventCollectionOrigin(event.eventId);
      await deleteEventObjects(event.eventId);
      const complete = await deleteEventRecords(event.eventId);
      if (!complete || eventDeadline > Math.floor(Date.now() / 1000)) continue;
      await deleteEventCollection(event.eventId);
      await dynamo.send(
        new DeleteCommand({
          TableName: tableName,
          Key: eventKey(event.eventId),
        }),
      );
      purged += 1;
      emitLog('INFO', 'event_retention_purged', correlationId, {
        eventId: event.eventId,
      });
    }

    emitLog('INFO', 'retention_purge_completed', correlationId, {
      expiredEvents: purged,
      durationMs: Date.now() - startedAt,
    });
    return { expiredEvents: purged };
  } catch (caught) {
    // A failure aborts the whole run, leaving later expired events un-purged
    // until the next schedule, so it must be visible.
    emitLog('ERROR', 'retention_purge_failed', correlationId, {
      purgedEvents: purged,
      errorName: errorNameOf(caught),
      durationMs: Date.now() - startedAt,
    });
    throw caught;
  }
}
