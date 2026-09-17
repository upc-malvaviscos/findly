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
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  faceGsi1PartitionKey,
  matchKey,
  parseRegistrationId,
  toEpochSeconds,
} from '../shared/lib/dynamoKeys';
import { parseEventPhotoObjectKey } from '../shared/lib/s3Keys';
import { eventCollectionId } from '../shared/lib/rekognitionCollections';
import type { MatchEntity } from '../shared/types/entities';

const FACE_MATCH_THRESHOLD = 95.0;
const SEARCH_MAX_FACES = 50;
const MATCH_RETENTION_DAYS = 30;
const MATCH_RETENTION_SECONDS = MATCH_RETENTION_DAYS * 24 * 60 * 60;

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
): Array<{ bucket: string; eventId: string; photoId: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const records = (parsed as { Records?: S3EventRecord[] }).Records ?? [];
  const parsedRecords: Array<{
    bucket: string;
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
    parsedRecords.push({ bucket, ...parsedKey });
  }
  return parsedRecords;
}

async function findRegistrationIdForFace(
  faceId: string,
): Promise<string | null> {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': faceGsi1PartitionKey(faceId) },
      Limit: 1,
    }),
  );
  const item = result.Items?.[0] as { GSI1SK?: string } | undefined;
  if (!item?.GSI1SK) return null;
  return parseRegistrationId(item.GSI1SK);
}

async function writeMatch(
  eventId: string,
  registrationId: string,
  photoId: string,
  similarity: number,
): Promise<void> {
  const matchedAt = new Date().toISOString();
  const match: MatchEntity = {
    matchId: randomUUID(),
    eventId,
    registrationId,
    photoId,
    similarity,
    matchedAt,
    ttl: toEpochSeconds(MATCH_RETENTION_SECONDS),
  };
  try {
    await dynamo.send(
      new PutCommand({
        TableName: tableName,
        Item: { ...matchKey(registrationId, photoId), ...match },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException')
      return;
    throw error;
  }
}

async function matchPhoto(
  bucket: string,
  eventId: string,
  photoId: string,
): Promise<void> {
  const collectionId = eventCollectionId(eventId);
  const indexed = await rekognition.send(
    new IndexFacesCommand({
      CollectionId: collectionId,
      Image: {
        S3Object: {
          Bucket: bucket,
          Name: `events/${eventId}/photos/${photoId}.jpg`,
        },
      },
      ExternalImageId: `PHOTO#${photoId}`,
      QualityFilter: 'AUTO',
    }),
  );
  const detectedFaceIds = (indexed.FaceRecords ?? [])
    .map((record) => record.Face?.FaceId)
    .filter((faceId): faceId is string => Boolean(faceId));

  try {
    for (const detectedFaceId of detectedFaceIds) {
      const searched = await rekognition.send(
        new SearchFacesCommand({
          CollectionId: collectionId,
          FaceId: detectedFaceId,
          FaceMatchThreshold: FACE_MATCH_THRESHOLD,
          MaxFaces: SEARCH_MAX_FACES,
        }),
      );
      for (const faceMatch of searched.FaceMatches ?? []) {
        const matchedFaceId = faceMatch.Face?.FaceId;
        const similarity = faceMatch.Similarity;
        if (!matchedFaceId || similarity === undefined) continue;
        if (matchedFaceId === detectedFaceId) continue;
        if (similarity < FACE_MATCH_THRESHOLD) continue;
        const registrationId = await findRegistrationIdForFace(matchedFaceId);
        if (!registrationId) continue;
        await writeMatch(eventId, registrationId, photoId, similarity);
      }
    }
  } finally {
    if (detectedFaceIds.length > 0)
      await rekognition.send(
        new DeleteFacesCommand({
          CollectionId: collectionId,
          FaceIds: detectedFaceIds,
        }),
      );
  }
}

export async function photoMatcher(
  event: PhotoMatcherEvent,
): Promise<PhotoMatcherResult> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    try {
      const photoEvents = parseS3PhotoEvents(record.body);
      for (const { bucket, eventId, photoId } of photoEvents)
        await matchPhoto(bucket, eventId, photoId);
    } catch {
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
