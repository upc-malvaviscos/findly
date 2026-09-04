import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

type GalleryEvent = {
  queryStringParameters?: Record<string, string | undefined> | null;
};

type GalleryItem = Record<string, unknown> & {
  registrationId?: string;
  eventId?: string;
  expiresAt?: string;
  eventName?: string;
  photoId?: string;
  s3Key?: string;
  matchedAt?: string;
};

type GalleryResponse = {
  eventId: string;
  eventName: string;
  photos: Array<{ photoId: string; url: string; matchedAt: string }>;
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
): GalleryResult =>
  json(statusCode, { code, message, requestId: crypto.randomUUID() });

export async function gallery(event: GalleryEvent): Promise<GalleryResult> {
  const token = event.queryStringParameters?.token;
  if (!token)
    return error(400, 'INVALID_REQUEST', 'Gallery token is required.');

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const tokenRecord = (
    await dynamo.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `TOKEN#${tokenHash}`, SK: 'METADATA' },
        ProjectionExpression: 'registrationId, eventId, expiresAt',
      }),
    )
  ).Item as GalleryItem | undefined;

  if (
    !tokenRecord?.registrationId ||
    !tokenRecord.eventId ||
    !tokenRecord.expiresAt
  )
    return error(404, 'GALLERY_NOT_FOUND', 'Gallery not found.');
  if (Date.parse(tokenRecord.expiresAt) <= Date.now())
    return error(410, 'GALLERY_EXPIRED', 'Gallery link has expired.');

  const matches = (
    await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `REG#${tokenRecord.registrationId}`,
          ':sk': 'MATCH#',
        },
        ProjectionExpression: 'photoId, eventId, matchedAt',
      }),
    )
  ).Items as GalleryItem[] | undefined;

  const eventRecord = (
    await dynamo.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `EVENT#${tokenRecord.eventId}`, SK: 'METADATA' },
        ProjectionExpression: '#name',
        ExpressionAttributeNames: { '#name': 'name' },
      }),
    )
  ).Item as GalleryItem | undefined;

  const photos = await Promise.all(
    (matches ?? []).map(async (match) => {
      if (!match.photoId || !match.matchedAt) return null;
      const photo = (
        await dynamo.send(
          new GetCommand({
            TableName: tableName,
            Key: {
              PK: `EVENT#${tokenRecord.eventId}`,
              SK: `PHOTO#${match.photoId}`,
            },
            ProjectionExpression: 's3Key',
          }),
        )
      ).Item as GalleryItem | undefined;
      if (!photo?.s3Key) return null;
      const signedUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: photoBucket, Key: photo.s3Key }),
        { expiresIn: 300 },
      );
      const publicUrl = process.env.FLOCI_PUBLIC_URL;
      return {
        photoId: match.photoId,
        matchedAt: match.matchedAt,
        url: publicUrl
          ? `${publicUrl}${new URL(signedUrl).pathname}${new URL(signedUrl).search}`
          : signedUrl,
      };
    }),
  );

  const response: GalleryResponse = {
    eventId: tokenRecord.eventId,
    eventName: String(
      eventRecord?.name ?? process.env.FINDLY_EVENT_NAME ?? 'Findly Demo Night',
    ),
    expiresAt: tokenRecord.expiresAt,
    photos: photos.filter(
      (photo): photo is NonNullable<typeof photo> => photo !== null,
    ),
  };
  return json(200, response);
}
