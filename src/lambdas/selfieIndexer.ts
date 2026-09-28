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
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
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
const tableName = process.env.FINDLY_TABLE_NAME ?? 'findly-local';
type S3Record = {
  s3?: { bucket?: { name?: string }; object?: { key?: string } };
};
export async function selfieIndexer(
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
      item.status === 'ENROLLED' ||
      item.status === 'FAILED'
    )
      continue;
    if (
      !item.consentTimestamp ||
      item.selfieS3Key !== key ||
      item.ttl <= Math.floor(Date.now() / 1000)
    )
      continue;
    const claim = randomUUID();
    await db.send(
      new UpdateCommand({
        TableName: tableName,
        Key: primaryKey,
        UpdateExpression:
          'SET #status = :processing, processingLeaseUntil = :lease, processingClaim = :claim',
        ConditionExpression:
          'attribute_exists(PK) AND attribute_not_exists(erasureRequestedAt) AND (#status = :pending OR (#status = :processing AND processingLeaseUntil < :now))',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':processing': 'PROCESSING',
          ':pending': 'UPLOAD_PENDING',
          ':lease': Date.now() + 30000,
          ':now': Date.now(),
          ':claim': claim,
        },
      }),
    );
    let faceId: string | undefined;
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
      const gsi = faceId ? faceGsi1Key(faceId, registrationId!) : undefined;
      await db.send(
        new UpdateCommand({
          TableName: tableName,
          Key: primaryKey,
          UpdateExpression: faceId
            ? 'SET #status = :status, faceId = :face, GSI1PK = :gpk, GSI1SK = :gsk REMOVE processingLeaseUntil, processingClaim'
            : 'SET #status = :status REMOVE processingLeaseUntil, processingClaim',
          ConditionExpression:
            'attribute_exists(PK) AND attribute_not_exists(erasureRequestedAt) AND processingClaim = :claim',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': faceId ? 'ENROLLED' : 'FAILED',
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

      // A registration erased during indexing must not leave a biometric orphan.
      if (faceId && errorNameOf(error) === 'ConditionalCheckFailedException') {
        try {
          await rekognition.send(
            new DeleteFacesCommand({
              CollectionId: eventCollectionId(eventId!),
              FaceIds: [faceId],
            }),
          );
        } catch (failure) {
          if (errorNameOf(failure) !== 'ResourceNotFoundException')
            throw failure;
        }
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
