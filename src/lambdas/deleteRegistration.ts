import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  DeleteFacesCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  galleryTokenKey,
  MATCH_SK_PREFIX,
  matchKey,
  registrationKey,
  registrationPartitionKey,
} from '../shared/lib/dynamoKeys';
import { selfieObjectKey } from '../shared/lib/s3Keys';
import { eventCollectionId } from '../shared/lib/rekognitionCollections';
import { isMissingResourceError } from './lib/awsErrors';
import type {
  GalleryTokenEntity,
  MatchEntity,
  RegistrationEntity,
} from '../shared/types/entities';

type DeleteRegistrationEvent = {
  pathParameters?: Record<string, string | undefined> | null;
  headers?: Record<string, string | undefined> | null;
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
): DeleteRegistrationResult =>
  json(statusCode, { code, message, requestId: crypto.randomUUID() });

const noContent = (): DeleteRegistrationResult => ({
  statusCode: 204,
  headers: {},
  body: '',
});

export async function deleteRegistration(
  event: DeleteRegistrationEvent,
): Promise<DeleteRegistrationResult> {
  const registrationId = event.pathParameters?.registrationId;
  const token = event.headers?.['x-gallery-token'];
  if (!registrationId || !token)
    return error(
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
      }),
    )
  ).Item as
    Partial<Pick<GalleryTokenEntity, 'registrationId' | 'eventId'>> | undefined;

  if (
    !tokenRecord?.registrationId ||
    !tokenRecord.eventId ||
    tokenRecord.registrationId !== registrationId
  )
    return error(404, 'REGISTRATION_NOT_FOUND', 'Registration not found.');

  const { eventId } = tokenRecord;

  const registrationRecord = (
    await dynamo.send(
      new GetCommand({
        TableName: tableName,
        Key: registrationKey(eventId, registrationId),
        ProjectionExpression: 'faceId',
      }),
    )
  ).Item as Partial<Pick<RegistrationEntity, 'faceId'>> | undefined;

  if (registrationRecord?.faceId) {
    try {
      await rekognition.send(
        new DeleteFacesCommand({
          CollectionId: eventCollectionId(eventId),
          FaceIds: [registrationRecord.faceId],
        }),
      );
    } catch (deleteFaceError) {
      if (!isMissingResourceError(deleteFaceError)) throw deleteFaceError;
    }
  }

  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: selfieBucket,
        Key: selfieObjectKey(eventId, registrationId),
      }),
    );
  } catch (deleteSelfieError) {
    if (!isMissingResourceError(deleteSelfieError)) throw deleteSelfieError;
  }

  const matches = (
    await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': registrationPartitionKey(registrationId),
          ':sk': MATCH_SK_PREFIX,
        },
        ProjectionExpression: 'photoId',
      }),
    )
  ).Items as Partial<Pick<MatchEntity, 'photoId'>>[] | undefined;

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

  console.log(
    JSON.stringify({
      event: 'registration_erased',
      eventId,
      registrationId,
      matchesDeleted: photoIds.length,
      faceDeleted: Boolean(registrationRecord?.faceId),
    }),
  );

  return noContent();
}
