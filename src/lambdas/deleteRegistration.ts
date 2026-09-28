import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  DeleteFacesCommand,
  ListFacesCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  galleryTokenKey,
  MATCH_SK_PREFIX,
  matchKey,
  registrationKey,
  registrationPartitionKey,
} from '../shared/lib/dynamoKeys';
import {
  cleanupDeadline,
  localCleanupWithoutBiometrics,
  isRetentionLocator,
  retentionLocatorKey,
} from '../shared/lib/retentionCleanup';
import { selfieObjectKey } from '../shared/lib/s3Keys';
import { eventCollectionId } from '../shared/lib/rekognitionCollections';
import { isMissingResourceError } from './lib/awsErrors';
import {
  withRequestLog,
  type LambdaContextLike,
  type RequestLog,
} from './lib/logger';
import type {
  GalleryTokenEntity,
  MatchEntity,
  RegistrationEntity,
} from '../shared/types/entities';

type DeleteRegistrationEvent = {
  pathParameters?: Record<string, string | undefined> | null;
  headers?: Record<string, string | undefined> | null;
  requestContext?: { requestId?: string } | null;
};

export type DeleteRegistrationResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const tableName = process.env.FINDLY_TABLE_NAME ?? 'findly-local';
const selfieBucket = process.env.FINDLY_SELFIE_BUCKET ?? 'findly-local-selfies';
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

const json = (statusCode: number, body: unknown): DeleteRegistrationResult => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const error = (
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
): DeleteRegistrationResult => json(statusCode, { code, message, requestId });

const noContent = (): DeleteRegistrationResult => ({
  statusCode: 204,
  headers: {},
  body: '',
});

export async function deleteRegistration(
  event: DeleteRegistrationEvent,
  context?: LambdaContextLike,
): Promise<DeleteRegistrationResult> {
  return withRequestLog(
    'delete_registration_request',
    {
      requestId: event.requestContext?.requestId,
      awsRequestId: context?.awsRequestId,
    },
    (request) => eraseRegistration(event, request),
  );
}

async function eraseRegistration(
  event: DeleteRegistrationEvent,
  request: RequestLog,
): Promise<DeleteRegistrationResult> {
  const fail = (statusCode: number, code: string, message: string) =>
    error(statusCode, code, message, request.correlationId);

  const registrationId = event.pathParameters?.registrationId;
  const token = Object.entries(event.headers ?? {}).find(
    ([name]) => name.toLowerCase() === 'x-gallery-token',
  )?.[1];
  if (!registrationId || !token)
    return fail(
      400,
      'INVALID_REQUEST',
      'A registrationId and the X-Gallery-Token header are required.',
    );

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const tokenRecord = (
    await dynamo.send(
      new GetCommand({
        TableName: tableName,
        Key: galleryTokenKey(tokenHash),
        ProjectionExpression: 'registrationId, eventId',
        ConsistentRead: true,
      }),
    )
  ).Item as
    Partial<Pick<GalleryTokenEntity, 'registrationId' | 'eventId'>> | undefined;

  if (
    !tokenRecord?.registrationId ||
    !tokenRecord.eventId ||
    tokenRecord.registrationId !== registrationId
  )
    return fail(404, 'REGISTRATION_NOT_FOUND', 'Registration not found.');

  const { eventId } = tokenRecord;
  request.annotate({ eventId });

  let registrationRecord = (
    await dynamo.send(
      new GetCommand({
        TableName: tableName,
        Key: registrationKey(eventId, registrationId),
        ProjectionExpression: 'faceId, selfieS3Key',
        ConsistentRead: true,
      }),
    )
  ).Item as
    Partial<Pick<RegistrationEntity, 'faceId' | 'selfieS3Key'>> | undefined;

  try {
    const marked = await dynamo.send(
      new UpdateCommand({
        TableName: tableName,
        Key: registrationKey(eventId, registrationId),
        UpdateExpression:
          'SET erasureRequestedAt = if_not_exists(erasureRequestedAt, :now)',
        ExpressionAttributeValues: { ':now': new Date().toISOString() },
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    // Take the face from the atomic write response: enrollment may have
    // completed between the initial read and the erasure marker.
    if (marked.Attributes) registrationRecord = marked.Attributes;
  } catch (markError) {
    if (
      (markError as { name?: string }).name !==
      'ConditionalCheckFailedException'
    )
      throw markError;
  }

  const locatorItem = (
    await dynamo.send(
      new GetCommand({
        TableName: tableName,
        Key: retentionLocatorKey(eventId, registrationId),
        ConsistentRead: true,
      }),
    )
  ).Item;
  const locator = isRetentionLocator(locatorItem) ? locatorItem : undefined;
  if (
    process.env.FINDLY_COLLECTION_NAMESPACE &&
    ((locator && locator.collectionId !== eventCollectionId(eventId)) ||
      (!locator && registrationRecord?.faceId))
  )
    throw new Error('LegacyFaceCollectionMigrationRequired');
  if (locator) {
    await dynamo.send(
      new UpdateCommand({
        TableName: tableName,
        Key: retentionLocatorKey(eventId, registrationId),
        UpdateExpression:
          'SET cleanupState = :state, erasureRequestedAt = if_not_exists(erasureRequestedAt, :now), cleanupAfter = if_not_exists(cleanupAfter, :after)',
        ExpressionAttributeValues: {
          ':state': 'DELETING',
          ':now': new Date().toISOString(),
          ':after': cleanupDeadline(locator.uploadExpiresAt),
        },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  }

  const storedSelfieKey =
    locator?.selfieS3Key ?? registrationRecord?.selfieS3Key;
  const legacySelfieKey = `events/${eventId}/selfies/${registrationId}.jpg`;
  const currentSelfieKey = `events/${eventId}/selfies/${registrationId}.selfie.jpg`;
  if (
    storedSelfieKey !== undefined &&
    storedSelfieKey !== legacySelfieKey &&
    storedSelfieKey !== currentSelfieKey
  ) {
    request.info('registration_erasure_invalid_selfie_key', { eventId });
    throw new Error('InvalidRegistrationSelfieKey');
  }
  const selfieKey = storedSelfieKey ?? selfieObjectKey(eventId, registrationId);

  const faceIds = new Set(locator?.faceIds ?? []);
  if (registrationRecord?.faceId) faceIds.add(registrationRecord.faceId);
  // Reconcile the crash window between IndexFaces and durable persistence.
  const localWithoutBiometrics = localCleanupWithoutBiometrics(
    endpoint,
    faceIds.size,
  );
  if (!localWithoutBiometrics) {
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
        for (const face of page.Faces ?? []) {
          if (face.ExternalImageId === registrationId && face.FaceId)
            faceIds.add(face.FaceId);
        }
        nextToken = page.NextToken;
      } while (nextToken);
    } catch (listError) {
      if (!isMissingResourceError(listError)) throw listError;
    }
  }
  if (locator && faceIds.size) {
    await dynamo.send(
      new UpdateCommand({
        TableName: tableName,
        Key: retentionLocatorKey(eventId, registrationId),
        UpdateExpression: 'ADD faceIds :faces',
        ExpressionAttributeValues: { ':faces': faceIds },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  }
  for (const faceId of faceIds) {
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
    } catch (deleteFaceError) {
      if (!isMissingResourceError(deleteFaceError)) throw deleteFaceError;
    }
  }

  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: selfieBucket,
        Key: selfieKey,
      }),
    );
  } catch (deleteSelfieError) {
    if (!isMissingResourceError(deleteSelfieError)) throw deleteSelfieError;
  }

  let matchesDeleted = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': registrationPartitionKey(registrationId),
          ':sk': MATCH_SK_PREFIX,
        },
        ProjectionExpression: 'photoId',
        ConsistentRead: true,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    const matches = page.Items as
      Partial<Pick<MatchEntity, 'photoId'>>[] | undefined;
    const photoIds = (matches ?? [])
      .map((match) => match.photoId)
      .filter((photoId): photoId is string => Boolean(photoId));
    await Promise.all(
      photoIds.map((photoId) =>
        dynamo.send(
          new DeleteCommand({
            TableName: tableName,
            Key: matchKey(registrationId, photoId),
          }),
        ),
      ),
    );
    matchesDeleted += photoIds.length;
    exclusiveStartKey = page.LastEvaluatedKey as
      Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  await dynamo.send(
    new DeleteCommand({
      TableName: tableName,
      Key: registrationKey(eventId, registrationId),
    }),
  );

  await dynamo.send(
    new DeleteCommand({
      TableName: tableName,
      Key: galleryTokenKey(tokenHash),
    }),
  );

  if (locator) {
    await dynamo.send(
      new UpdateCommand({
        TableName: tableName,
        Key: retentionLocatorKey(eventId, registrationId),
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

  // Audit line for the erasure metric. It carries no registrationId: the
  // identifier of a person who asked to be forgotten would otherwise stay in
  // CloudWatch Logs for the retention period. The correlationId ties it to the
  // request summary line and to the requestId the client received.
  request.info('registration_erased', {
    eventId,
    matchesDeleted,
    faceDeleted: faceIds.size > 0,
  });

  return noContent();
}
