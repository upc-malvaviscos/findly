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
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { eventCollectionId } from '../shared/lib/rekognitionCollections';
import { isMissingResourceError } from './lib/awsErrors';
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
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'SK = :metadata AND begins_with(PK, :eventPrefix)',
        ExpressionAttributeValues: {
          ':metadata': 'METADATA',
          ':eventPrefix': 'EVENT#',
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
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: uploadsBucket,
          Delete: { Objects: batch.map((Key) => ({ Key })) },
        }),
      );
    }
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
}

export async function retentionPurger(): Promise<RetentionPurgerResult> {
  const expiredEvents = await findExpiredEvents(Date.now());

  for (const event of expiredEvents) {
    await deleteEventCollection(event.eventId);
    await deleteEventObjects(event.eventId);
    console.log(
      JSON.stringify({
        event: 'event_retention_purged',
        eventId: event.eventId,
      }),
    );
  }

  return { expiredEvents: expiredEvents.length };
}
