import {
  DeleteCollectionCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  eventKey,
  galleryTokenKey,
  registrationPartitionKey,
  EVENT_LISTING_GSI2_PARTITION_KEY,
} from '../shared/lib/dynamoKeys';
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
>;

function isExpired(
  event: Partial<EventEntity>,
  now: number,
): event is ExpiredEvent {
  if (!event.eventId || !event.createdAt || event.retentionDays === undefined)
    return false;
  const expiresAt =
    Date.parse(event.createdAt) + event.retentionDays * MILLISECONDS_PER_DAY;
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

async function findExpiredEvents(now: number): Promise<ExpiredEvent[]> {
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
        ProjectionExpression: 'eventId, createdAt, retentionDays',
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const item of (page.Items ?? []) as Partial<EventEntity>[])
      if (isExpired(item, now)) expired.push(item);
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

async function deleteEventRecords(eventId: string): Promise<void> {
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
      await dynamo.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { PK: item.PK, SK: item.SK },
        }),
      );
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  // Metadata is the retry marker. Remove it only after all external resources
  // and linked records were successfully removed.
  await dynamo.send(
    new DeleteCommand({ TableName: tableName, Key: eventKey(eventId) }),
  );
}

export async function retentionPurger(
  _event?: unknown,
  context?: LambdaContextLike,
): Promise<RetentionPurgerResult> {
  const startedAt = Date.now();
  const correlationId = resolveCorrelationId(context?.awsRequestId);
  let purged = 0;

  try {
    const expiredEvents = await findExpiredEvents(Date.now());

    for (const event of expiredEvents) {
      await deleteEventCollection(event.eventId);
      await deleteEventObjects(event.eventId);
      await deleteEventRecords(event.eventId);
      purged += 1;
      emitLog('INFO', 'event_retention_purged', correlationId, {
        eventId: event.eventId,
      });
    }

    emitLog('INFO', 'retention_purge_completed', correlationId, {
      expiredEvents: expiredEvents.length,
      durationMs: Date.now() - startedAt,
    });
    return { expiredEvents: expiredEvents.length };
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
