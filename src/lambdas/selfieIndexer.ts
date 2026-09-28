import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CreateCollectionCommand,
  DeleteFacesCommand,
  IndexFacesCommand,
  ListFacesCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import {
  retentionLocatorKey,
  type RetentionLocatorEntity,
} from '../shared/lib/retentionCleanup';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { registrationKey, faceGsi1Key } from '../shared/lib/dynamoKeys';
import { eventCollectionId } from '../shared/lib/rekognitionCollections';
import {
  emitLog,
  errorNameOf,
  resolveCorrelationId,
  type LambdaContextLike,
} from './lib/logger';
import type { RegistrationEntity } from '../shared/types/entities';
const endpoint = process.env.AWS_ENDPOINT_URL;
const options = {
  region: process.env.AWS_REGION ?? 'eu-west-1',
  ...(endpoint ? { endpoint } : {}),
};
const db = DynamoDBDocumentClient.from(new DynamoDBClient(options));
const rekognition = new RekognitionClient(options);
const s3 = new S3Client({ ...options, forcePathStyle: Boolean(endpoint) });
const tableName = process.env.FINDLY_TABLE_NAME ?? 'findly-local';
type S3Record = {
  s3?: { bucket?: { name?: string }; object?: { key?: string } };
};
async function deleteFaces(
  eventId: string,
  faceIds: Set<string>,
): Promise<void> {
  const ids = [...faceIds];
  for (let offset = 0; offset < ids.length; offset += 100) {
    try {
      const result = await rekognition.send(
        new DeleteFacesCommand({
          CollectionId: eventCollectionId(eventId),
          FaceIds: ids.slice(offset, offset + 100),
        }),
      );
      if (
        result.UnsuccessfulFaceDeletions?.some(
          (failure) =>
            !(
              failure.Reasons?.length &&
              failure.Reasons.every((reason) => reason === 'FACE_NOT_FOUND')
            ),
        )
      )
        throw new Error('FACE_CLEANUP_INCOMPLETE');
    } catch (failure) {
      if (errorNameOf(failure) !== 'ResourceNotFoundException') throw failure;
    }
  }
}
async function reconcileErased(
  eventId: string,
  registrationId: string,
  bucket: string,
  key: string,
  additionalFaces: string[] = [],
): Promise<void> {
  const locatorKey = retentionLocatorKey(eventId, registrationId);
  const locator = (
    await db.send(
      new GetCommand({
        TableName: tableName,
        Key: locatorKey,
        ConsistentRead: true,
      }),
    )
  ).Item as RetentionLocatorEntity | undefined;
  if (
    process.env.FINDLY_COLLECTION_NAMESPACE &&
    locator &&
    (!('collectionId' in locator) ||
      locator.collectionId !== eventCollectionId(eventId))
  )
    throw new Error('COLLECTION_OWNERSHIP_UNVERIFIED');
  const knownFaces = new Set([...(locator?.faceIds ?? []), ...additionalFaces]);
  let cursor: string | undefined;
  do {
    try {
      const page = await rekognition.send(
        new ListFacesCommand({
          CollectionId: eventCollectionId(eventId),
          MaxResults: 1000,
          NextToken: cursor,
        }),
      );
      for (const face of page.Faces ?? [])
        if (face.ExternalImageId === registrationId && face.FaceId)
          knownFaces.add(face.FaceId);
      cursor = page.NextToken;
    } catch (failure) {
      if (errorNameOf(failure) !== 'ResourceNotFoundException') throw failure;
      cursor = undefined;
    }
  } while (cursor);
  if (locator && knownFaces.size) {
    try {
      await db.send(
        new UpdateCommand({
          TableName: tableName,
          Key: locatorKey,
          UpdateExpression: 'SET cleanupState = :deleting ADD faceIds :faces',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeValues: {
            ':deleting': 'DELETING',
            ':faces': knownFaces,
          },
        }),
      );
    } catch (failure) {
      if (errorNameOf(failure) !== 'ConditionalCheckFailedException')
        throw failure;
    }
  }
  await deleteFaces(eventId, knownFaces);
  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: locator?.selfieS3Key ?? key,
      }),
    );
  } catch (failure) {
    if (
      !['NoSuchKey', 'NoSuchBucket', 'NotFound'].includes(errorNameOf(failure))
    )
      throw failure;
  }
  // Keep the durable tombstone: late S3 deliveries and expired PUTs are reconciled again.
  if (locator) {
    try {
      await db.send(
        new UpdateCommand({
          TableName: tableName,
          Key: locatorKey,
          UpdateExpression: `SET cleanupState = :cleaned, cleanupCompletedAt = :now${knownFaces.size ? ' DELETE faceIds :faces' : ''}`,
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeValues: {
            ':cleaned': 'CLEANED',
            ':now': new Date().toISOString(),
            ...(knownFaces.size ? { ':faces': knownFaces } : {}),
          },
        }),
      );
    } catch (failure) {
      if (errorNameOf(failure) !== 'ConditionalCheckFailedException')
        throw failure;
    }
  }
}
async function processSelfies(
  event: { Records: S3Record[] },
  context?: LambdaContextLike,
): Promise<void> {
  const correlationId = resolveCorrelationId(context?.awsRequestId);
  for (const record of event.Records) {
    const bucket = record.s3?.bucket?.name;
    const rawKey = record.s3?.object?.key;
    if (!bucket || !rawKey) continue;
    const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    const match = /^events\/([^/]+)\/selfies\/([^/]+?)(?:\.selfie)?\.jpg$/.exec(
      key,
    );
    if (!match) continue;
    const [, eventId, registrationId] = match;
    const primaryKey = registrationKey(eventId!, registrationId!);
    const item = (
      await db.send(
        new GetCommand({
          TableName: tableName,
          Key: primaryKey,
          ConsistentRead: true,
        }),
      )
    ).Item as RegistrationEntity | undefined;
    if (
      !item ||
      'erasureRequestedAt' in item ||
      item.ttl <= Math.floor(Date.now() / 1000)
    ) {
      await reconcileErased(eventId!, registrationId!, bucket, key);
      continue;
    }
    if (item.status === 'ENROLLED' || item.status === 'FAILED') continue;
    if (
      !item.consentTimestamp ||
      item.selfieS3Key !== key ||
      item.ttl <= Math.floor(Date.now() / 1000)
    )
      continue;
    const claim = randomUUID();
    try {
      await db.send(
        new UpdateCommand({
          TableName: tableName,
          Key: primaryKey,
          UpdateExpression:
            'SET #status = :processing, processingLeaseUntil = :lease, processingClaim = :claim',
          ConditionExpression:
            'attribute_exists(PK) AND attribute_not_exists(erasureRequestedAt) AND ttl > :nowEpoch AND (#status = :pending OR (#status = :processing AND processingLeaseUntil < :now))',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':processing': 'PROCESSING',
            ':pending': 'UPLOAD_PENDING',
            ':lease': Date.now() + 30000,
            ':now': Date.now(),
            ':nowEpoch': Math.floor(Date.now() / 1000),
            ':claim': claim,
          },
        }),
      );
    } catch (failure) {
      if (errorNameOf(failure) === 'ConditionalCheckFailedException') continue;
      throw failure;
    }
    let faceId: string | undefined;
    let recordedFace = false;
    try {
      try {
        await rekognition.send(
          new CreateCollectionCommand({
            CollectionId: eventCollectionId(eventId!),
            Tags: {
              Project: process.env.FINDLY_PROJECT ?? 'findly',
              Environment: process.env.FINDLY_ENVIRONMENT ?? 'local',
              ManagedBy: 'Terraform',
              CostCenter: process.env.FINDLY_COST_CENTER ?? 'local-validation',
              DataClass: process.env.FINDLY_DATA_CLASS ?? 'synthetic',
            },
          }),
        );
      } catch (error) {
        if (errorNameOf(error) !== 'ResourceAlreadyExistsException')
          throw error;
      }
      const result = await rekognition.send(
        new IndexFacesCommand({
          CollectionId: eventCollectionId(eventId!),
          Image: { S3Object: { Bucket: bucket, Name: key } },
          ExternalImageId: registrationId,
          MaxFaces: 1,
          QualityFilter: 'AUTO',
          DetectionAttributes: [],
        }),
      );
      faceId = result.FaceRecords?.[0]?.Face?.FaceId;
      if (faceId) {
        const tracking = await db.send(
          new UpdateCommand({
            TableName: tableName,
            Key: retentionLocatorKey(eventId!, registrationId!),
            UpdateExpression: 'ADD faceIds :faces',
            ConditionExpression: 'attribute_exists(PK)',
            ExpressionAttributeValues: { ':faces': new Set([faceId]) },
            ReturnValues: 'ALL_NEW',
          }),
        );
        recordedFace = true;
        if (
          tracking.Attributes?.cleanupState !== 'ACTIVE' ||
          tracking.Attributes.erasureRequestedAt
        ) {
          await reconcileErased(eventId!, registrationId!, bucket, key, [
            faceId,
          ]);
          continue;
        }
      }
      const gsi = faceId ? faceGsi1Key(faceId, registrationId!) : undefined;
      await db.send(
        new UpdateCommand({
          TableName: tableName,
          Key: primaryKey,
          UpdateExpression: faceId
            ? 'SET #status = :status, faceId = :face, GSI1PK = :gpk, GSI1SK = :gsk REMOVE processingLeaseUntil, processingClaim'
            : 'SET #status = :status REMOVE processingLeaseUntil, processingClaim',
          ConditionExpression:
            'attribute_exists(PK) AND attribute_not_exists(erasureRequestedAt) AND processingClaim = :claim AND ttl > :nowEpoch',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': faceId ? 'ENROLLED' : 'FAILED',
            ':nowEpoch': Math.floor(Date.now() / 1000),
            ':claim': claim,
            ...(gsi
              ? { ':face': faceId, ':gpk': gsi.GSI1PK, ':gsk': gsi.GSI1SK }
              : {}),
          },
        }),
      );
      emitLog('INFO', 'selfie_indexed', correlationId, { eventId });
    } catch (error) {
      if (
        !faceId &&
        [
          'InvalidImageFormatException',
          'InvalidParameterException',
          'ImageTooLargeException',
          'ResourceNotFoundException',
        ].includes(errorNameOf(error))
      ) {
        try {
          await db.send(
            new UpdateCommand({
              TableName: tableName,
              Key: primaryKey,
              UpdateExpression:
                'SET #status = :failed REMOVE processingLeaseUntil, processingClaim',
              ConditionExpression:
                'attribute_exists(PK) AND attribute_not_exists(erasureRequestedAt) AND processingClaim = :claim',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':failed': 'FAILED',
                ':claim': claim,
              },
            }),
          );
        } catch (failure) {
          if (errorNameOf(failure) !== 'ConditionalCheckFailedException')
            throw failure;
        }
        continue;
      }

      if (faceId && errorNameOf(error) === 'ConditionalCheckFailedException') {
        const latest = (
          await db.send(
            new GetCommand({
              TableName: tableName,
              Key: primaryKey,
              ConsistentRead: true,
            }),
          )
        ).Item as RegistrationEntity | undefined;
        if (
          !latest ||
          'erasureRequestedAt' in latest ||
          latest.ttl <= Math.floor(Date.now() / 1000)
        ) {
          await reconcileErased(eventId!, registrationId!, bucket, key, [
            faceId,
          ]);
          continue;
        }
        if (latest.status === 'ENROLLED' && latest.faceId === faceId) continue;
        // A recoverable worker still owns this immutable image. Retain its tracked candidate.
        if (recordedFace && latest.status === 'PROCESSING') continue;
        await deleteFaces(eventId!, new Set([faceId]));
        continue;
      }
      emitLog('ERROR', 'selfie_index_failed', correlationId, {
        eventId,
        errorName: errorNameOf(error),
      });
      // Keep PROCESSING and its expiring lease: S3 retries recover transient failures.
      throw error;
    }
  }
}

export async function selfieIndexer(
  event: { Records: S3Record[] },
  context?: LambdaContextLike,
): Promise<void> {
  try {
    await processSelfies(event, context);
  } catch (failure) {
    const name = errorNameOf(failure);
    emitLog(
      'ERROR',
      'selfie_processing_failed',
      resolveCorrelationId(context?.awsRequestId),
      { errorName: name, recordCount: event.Records.length },
    );
    const allowed = [
      'FACE_CLEANUP_INCOMPLETE',
      'COLLECTION_OWNERSHIP_UNVERIFIED',
    ];
    const message =
      failure instanceof Error && allowed.includes(failure.message)
        ? failure.message
        : 'SELFIE_PROCESSING_FAILED';
    throw Object.assign(new Error(message), { name });
  }
}
