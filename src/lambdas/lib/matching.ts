import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
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
  matchMirrorKey,
  photoKey,
  registrationKey,
  parseRegistrationId,
} from '../../shared/lib/dynamoKeys';
import { eventCollectionId } from '../../shared/lib/rekognitionCollections';
import type { MatchEntity } from '../../shared/types/entities';

export const FACE_MATCH_THRESHOLD = 95.0;
const SEARCH_MAX_FACES = 50;
const FACE_VISIBILITY_RETRY_DELAYS_MS = [200, 500, 1000, 2000];
export type MatchStep =
  'index_faces' | 'search_faces' | 'write_match' | 'delete_faces';

function isNewlyIndexedFaceNotVisible(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: string; message?: string };
  return (
    candidate.name === 'InvalidParameterException' &&
    candidate.message?.toLowerCase() ===
      'faceid was not found in the collection.'
  );
}

export const tableName = process.env.FINDLY_TABLE_NAME ?? 'findly-local';
const endpoint = process.env.AWS_ENDPOINT_URL;
const clientOptions = endpoint
  ? { endpoint, region: 'eu-west-1' }
  : { region: 'eu-west-1' };
export const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient(clientOptions),
);
export const rekognition = new RekognitionClient(clientOptions);

export async function findRegistrationForFace(
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

export async function writeMatch(
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
          {
            // ADR-022: both matching triggers maintain the photo deletion index
            // atomically with the participant's gallery match.
            Put: {
              TableName: tableName,
              Item: {
                ...matchMirrorKey(eventId, photoId, registrationId),
                ...match,
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            // #166: serialized against the deletion barrier before mirror
            // cleanup. DynamoDB TTL removal is eventual, so also check logical
            // expiry against the timestamp sampled for this transaction.
            ConditionCheck: {
              TableName: tableName,
              Key: photoKey(eventId, photoId),
              ConditionExpression:
                'attribute_exists(PK) AND attribute_not_exists(deletedAt) AND #ttl > :now',
              ExpressionAttributeNames: { '#ttl': 'ttl' },
              ExpressionAttributeValues: {
                ':now': Math.floor(Date.now() / 1000),
              },
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

// Shared core: both the S3-triggered photo upload path (photoMatcher.ts) and
// the post-ENROLLED backfill path (registrationBackfill.ts) index the
// photo's face, search it against the event collection and write any match.
// Running it from either direction converges on the same idempotent write
// (writeMatch's attribute_not_exists(PK) condition), so a photo matched by
// both triggers never produces a duplicate match.
export async function matchPhoto(
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

  async function searchNewlyIndexedFace(faceId: string) {
    // AWS has returned "faceId was not found" for the ID from the preceding
    // IndexFaces call. Retry only that exact transient response.
    for (let attempt = 0; ; attempt++) {
      try {
        return await rekognition.send(
          new SearchFacesCommand({
            CollectionId: collectionId,
            FaceId: faceId,
            FaceMatchThreshold: FACE_MATCH_THRESHOLD,
            MaxFaces: SEARCH_MAX_FACES,
          }),
        );
      } catch (error) {
        if (
          !isNewlyIndexedFaceNotVisible(error) ||
          attempt === FACE_VISIBILITY_RETRY_DELAYS_MS.length
        )
          throw error;
        await setTimeout(FACE_VISIBILITY_RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  try {
    for (const detectedFaceId of detectedFaceIds) {
      const searched = await recordStep('search_faces', () =>
        searchNewlyIndexedFace(detectedFaceId),
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
