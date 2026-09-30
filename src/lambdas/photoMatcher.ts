import { randomUUID } from 'node:crypto';
import {
  DeleteFacesCommand,
  IndexFacesCommand,
  RekognitionClient,
  SearchFacesCommand,
} from '@aws-sdk/client-rekognition';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  faceGsi1PartitionKey,
  matchKey,
  registrationKey,
  parseRegistrationId,
} from '../shared/lib/dynamoKeys';
import { parseEventPhotoObjectKey } from '../shared/lib/s3Keys';
import { eventCollectionId } from '../shared/lib/rekognitionCollections';
import {
  emitLog,
  errorNameOf,
  resolveCorrelationId,
  type LambdaContextLike,
} from './lib/logger';
import type { MatchEntity } from '../shared/types/entities';

const FACE_MATCH_THRESHOLD = 95.0;
const SEARCH_MAX_FACES = 50;
type MatchStep =
  'index_faces' | 'search_faces' | 'write_match' | 'delete_faces';

const tableName = process.env.FINDLY_TABLE_NAME ?? 'findly-local';
const endpoint = process.env.AWS_ENDPOINT_URL;
const clientOptions = endpoint
  ? { endpoint, region: 'eu-west-1' }
  : { region: 'eu-west-1' };
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(clientOptions));
const rekognition = new RekognitionClient(clientOptions);

type S3EventRecord = {
  eventName?: string;
  s3?: { bucket?: { name?: string }; object?: { key?: string } };
};

type SqsRecord = { messageId: string; body: string };

export type PhotoMatcherEvent = { Records: SqsRecord[] };

export type PhotoMatcherResult = {
  batchItemFailures: Array<{ itemIdentifier: string }>;
};

function decodeObjectKey(rawKey: string): string {
  return decodeURIComponent(rawKey.replace(/\+/g, ' '));
}

function parseS3PhotoEvents(
  body: string,
): Array<{ bucket: string; key: string; eventId: string; photoId: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const records = (parsed as { Records?: S3EventRecord[] }).Records ?? [];
  const parsedRecords: Array<{
    bucket: string;
    key: string;
    eventId: string;
    photoId: string;
  }> = [];
  for (const record of records) {
    const bucket = record.s3?.bucket?.name;
    const rawKey = record.s3?.object?.key;
    if (!bucket || !rawKey) continue;
    const key = decodeObjectKey(rawKey);
    const parsedKey = parseEventPhotoObjectKey(key);
    if (!parsedKey) continue;
    parsedRecords.push({ bucket, key, ...parsedKey });
  }
  return parsedRecords;
}

async function findRegistrationForFace(
  faceId: string,
  eventId: string,
): Promise<{ registrationId: string; ttl: number; faceId: string } | null> {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': faceGsi1PartitionKey(faceId) },
      Limit: 1,
    }),
  );
  const item = result.Items?.[0] as
    | {
        GSI1SK?: string;
        eventId?: string;
        status?: string;
        ttl?: number;
      }
    | undefined;
  if (
    !item?.GSI1SK ||
    item.eventId !== eventId ||
    item.status !== 'ENROLLED' ||
    typeof item.ttl !== 'number' ||
    item.ttl <= Math.floor(Date.now() / 1000)
  )
    return null;
  const registrationId = parseRegistrationId(item.GSI1SK);
  return registrationId ? { registrationId, ttl: item.ttl, faceId } : null;
}

async function writeMatch(
  eventId: string,
  registrationId: string,
  photoId: string,
  similarity: number,
  ttl: number,
  faceId: string,
): Promise<void> {
  const matchedAt = new Date().toISOString();
  const match: MatchEntity = {
    matchId: randomUUID(),
    eventId,
    registrationId,
    photoId,
    similarity,
    matchedAt,
    ttl,
  };
  try {
    await dynamo.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: tableName,
              Key: registrationKey(eventId, registrationId),
              ConditionExpression:
                '#status = :enrolled AND faceId = :face AND #ttl = :ttl AND attribute_not_exists(erasureRequestedAt)',
              ExpressionAttributeNames: { '#status': 'status', '#ttl': 'ttl' },
              ExpressionAttributeValues: {
                ':enrolled': 'ENROLLED',
                ':face': faceId,
                ':ttl': ttl,
              },
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: { ...matchKey(registrationId, photoId), ...match },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      }),
    );
  } catch (error) {
    const failure = error as {
      name?: string;
      CancellationReasons?: Array<{ Code?: string }>;
    };
    if (
      failure.name === 'TransactionCanceledException' &&
      failure.CancellationReasons?.some(
        (reason) => reason.Code === 'ConditionalCheckFailed',
      ) &&
      failure.CancellationReasons.every(
        (reason) =>
          !reason.Code ||
          reason.Code === 'None' ||
          reason.Code === 'ConditionalCheckFailed',
      )
    )
      return;
    throw error;
  }
}

async function matchPhoto(
  bucket: string,
  eventId: string,
  photoId: string,
  key: string,
  onFailure: (step: MatchStep) => void,
): Promise<void> {
  const collectionId = eventCollectionId(eventId);
  async function recordStep<T>(
    step: MatchStep,
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      onFailure(step);
      throw error;
    }
  }
  const indexed = await recordStep('index_faces', () =>
    rekognition.send(
      new IndexFacesCommand({
        CollectionId: collectionId,
        Image: {
          S3Object: {
            Bucket: bucket,
            Name: key,
          },
        },
        ExternalImageId: `PHOTO:${photoId}`,
        QualityFilter: 'AUTO',
      }),
    ),
  );
  const detectedFaceIds = (indexed.FaceRecords ?? [])
    .map((record) => record.Face?.FaceId)
    .filter((faceId): faceId is string => Boolean(faceId));

  try {
    for (const detectedFaceId of detectedFaceIds) {
      const searched = await recordStep('search_faces', () =>
        rekognition.send(
          new SearchFacesCommand({
            CollectionId: collectionId,
            FaceId: detectedFaceId,
            FaceMatchThreshold: FACE_MATCH_THRESHOLD,
            MaxFaces: SEARCH_MAX_FACES,
          }),
        ),
      );
      for (const faceMatch of searched.FaceMatches ?? []) {
        const matchedFaceId = faceMatch.Face?.FaceId;
        const similarity = faceMatch.Similarity;
        if (!matchedFaceId || similarity === undefined) continue;
        if (matchedFaceId === detectedFaceId) continue;
        if (similarity < FACE_MATCH_THRESHOLD) continue;
        const registration = await findRegistrationForFace(
          matchedFaceId,
          eventId,
        );
        if (!registration) continue;
        await recordStep('write_match', () =>
          writeMatch(
            eventId,
            registration.registrationId,
            photoId,
            similarity,
            registration.ttl,
            registration.faceId,
          ),
        );
      }
    }
  } finally {
    if (detectedFaceIds.length > 0)
      await recordStep('delete_faces', () =>
        rekognition.send(
          new DeleteFacesCommand({
            CollectionId: collectionId,
            FaceIds: detectedFaceIds,
          }),
        ),
      );
  }
}

export async function photoMatcher(
  event: PhotoMatcherEvent,
  context?: LambdaContextLike,
): Promise<PhotoMatcherResult> {
  const batchStartedAt = Date.now();
  const batchId = resolveCorrelationId(context?.awsRequestId);
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    // One correlation ID per SQS message: it is what a redelivery and the DLQ
    // entry share, so a failed photo can be followed across its retries.
    const correlationId = resolveCorrelationId(
      record.messageId,
      context?.awsRequestId,
    );
    let current: { eventId: string; photoId: string } | undefined;
    let failedStep: MatchStep | undefined;
    try {
      const photoEvents = parseS3PhotoEvents(record.body);
      for (const { bucket, key, eventId, photoId } of photoEvents) {
        current = { eventId, photoId };
        const photoStartedAt = Date.now();
        await matchPhoto(bucket, eventId, photoId, key, (step) => {
          failedStep = step;
        });
        emitLog('INFO', 'photo_processed', correlationId, {
          eventId,
          photoId,
          durationMs: Date.now() - photoStartedAt,
        });
      }
    } catch (caught) {
      // Without this line a failing message would only surface as a DLQ
      // alarm with nothing to diagnose it. Only the error name and safe step
      // label are logged; request data and error messages stay out of logs.
      emitLog('ERROR', 'photo_matching_failed', correlationId, {
        ...current,
        step: failedStep,
        errorName: errorNameOf(caught),
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  emitLog('INFO', 'photo_batch_processed', batchId, {
    recordCount: event.Records.length,
    failedCount: batchItemFailures.length,
    durationMs: Date.now() - batchStartedAt,
  });

  return { batchItemFailures };
}
