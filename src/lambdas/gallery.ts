import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  eventKey,
  galleryTokenKey,
  MATCH_SK_PREFIX,
  photoKey,
  registrationPartitionKey,
  registrationKey,
} from '../shared/lib/dynamoKeys';
import {
  withRequestLog,
  type LambdaContextLike,
  type RequestLog,
} from './lib/logger';
import type {
  EventEntity,
  GalleryTokenEntity,
  MatchEntity,
  PhotoEntity,
} from '../shared/types/entities';

type GalleryEvent = {
  queryStringParameters?: Record<string, string | undefined> | null;
  requestContext?: { requestId?: string } | null;
};

type GalleryResponse = {
  eventId: string;
  eventName: string;
  registrationId: string;
  photos: Array<{
    photoId: string;
    url: string;
    downloadUrl: string;
    matchedAt: string;
  }>;
  expiresAt: string;
};

export type GalleryResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const tableName = process.env.FINDLY_TABLE_NAME ?? 'findly-local';
const photoBucket = process.env.FINDLY_PHOTO_BUCKET ?? 'findly-local-photos';
const endpoint = process.env.AWS_ENDPOINT_URL;
const clientOptions = endpoint
  ? { endpoint, region: 'eu-west-1' }
  : { region: 'eu-west-1' };
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(clientOptions));
const s3 = new S3Client({
  ...clientOptions,
  forcePathStyle: Boolean(endpoint),
});

const json = (statusCode: number, body: unknown): GalleryResult => ({
  statusCode,
  headers: {
    'content-type': 'application/json',
    'access-control-allow-origin':
      process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  },
  body: JSON.stringify(body),
});

const error = (
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
): GalleryResult => json(statusCode, { code, message, requestId });

export async function gallery(
  event: GalleryEvent,
  context?: LambdaContextLike,
): Promise<GalleryResult> {
  return withRequestLog(
    'gallery_request',
    {
      requestId: event.requestContext?.requestId,
      awsRequestId: context?.awsRequestId,
    },
    (request) => serveGallery(event, request),
  );
}

async function serveGallery(
  event: GalleryEvent,
  request: RequestLog,
): Promise<GalleryResult> {
  const fail = (statusCode: number, code: string, message: string) =>
    error(statusCode, code, message, request.correlationId);

  const token = event.queryStringParameters?.token;
  if (!token) return fail(400, 'INVALID_REQUEST', 'Gallery token is required.');

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const tokenRecord = (
    await dynamo.send(
      new GetCommand({
        TableName: tableName,
        Key: galleryTokenKey(tokenHash),
        ProjectionExpression:
          'registrationId, eventId, expiresAt, requireRegistration',
        ConsistentRead: true,
      }),
    )
  ).Item as
    | Partial<
        Pick<
          GalleryTokenEntity,
          'registrationId' | 'eventId' | 'expiresAt' | 'requireRegistration'
        >
      >
    | undefined;

  if (
    !tokenRecord?.registrationId ||
    !tokenRecord.eventId ||
    !tokenRecord.expiresAt
  )
    return fail(404, 'GALLERY_NOT_FOUND', 'Gallery not found.');

  const { registrationId, eventId, expiresAt } = tokenRecord;
  request.annotate({ eventId });
  if (Date.parse(expiresAt) <= Date.now())
    return fail(410, 'GALLERY_EXPIRED', 'Gallery link has expired.');

  if (tokenRecord.requireRegistration) {
    const registration = (
      await dynamo.send(
        new GetCommand({
          TableName: tableName,
          Key: registrationKey(eventId, registrationId),
          ConsistentRead: true,
        }),
      )
    ).Item;
    if (!registration || registration.erasureRequestedAt)
      return fail(404, 'GALLERY_NOT_FOUND', 'Gallery not found.');
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
        ProjectionExpression: 'photoId, eventId, matchedAt',
      }),
    )
  ).Items as
    | Partial<Pick<MatchEntity, 'photoId' | 'eventId' | 'matchedAt'>>[]
    | undefined;

  const eventRecord = (
    await dynamo.send(
      new GetCommand({
        TableName: tableName,
        Key: eventKey(eventId),
        ProjectionExpression: '#name',
        ExpressionAttributeNames: { '#name': 'name' },
      }),
    )
  ).Item as Partial<Pick<EventEntity, 'name'>> | undefined;

  const photos = await Promise.all(
    (matches ?? []).map(async (match) => {
      const { photoId, matchedAt } = match;
      if (!photoId || !matchedAt) return null;
      const photo = (
        await dynamo.send(
          new GetCommand({
            TableName: tableName,
            Key: photoKey(eventId, photoId),
            ProjectionExpression: 's3Key',
          }),
        )
      ).Item as Partial<Pick<PhotoEntity, 's3Key'>> | undefined;
      if (!photo?.s3Key) return null;
      const [signedUrl, signedDownloadUrl] = await Promise.all([
        getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: photoBucket, Key: photo.s3Key }),
          { expiresIn: 300 },
        ),
        getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: photoBucket,
            Key: photo.s3Key,
            ResponseContentDisposition: `attachment; filename="findly-${photoId}.jpg"`,
          }),
          { expiresIn: 300 },
        ),
      ]);
      const publicUrl = process.env.FLOCI_PUBLIC_URL;
      const toPublicUrl = (url: string) =>
        publicUrl
          ? `${publicUrl}${new URL(url).pathname}${new URL(url).search}`
          : url;
      return {
        photoId,
        matchedAt,
        url: toPublicUrl(signedUrl),
        downloadUrl: toPublicUrl(signedDownloadUrl),
      };
    }),
  );

  const response: GalleryResponse = {
    eventId,
    eventName: String(
      eventRecord?.name ?? process.env.FINDLY_EVENT_NAME ?? 'Findly Demo Night',
    ),
    registrationId,
    expiresAt,
    photos: photos.filter(
      (photo): photo is NonNullable<typeof photo> => photo !== null,
    ),
  };
  request.annotate({ photoCount: response.photos.length });
  return json(200, response);
}
