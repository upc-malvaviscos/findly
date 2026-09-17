import { createHash, randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  createAdminEventSchema,
  photoUploadRequestSchema,
} from '../shared/lib/validations';
import {
  eventKey,
  eventListingGsi2Key,
  EVENT_LISTING_GSI2_PARTITION_KEY,
  photoKey,
  toEpochSeconds,
} from '../shared/lib/dynamoKeys';
import { eventPhotoObjectKey } from '../shared/lib/s3Keys';
import { createPresignedUploadUrl } from './lib/presignedUpload';
import type { EventEntity, PhotoEntity } from '../shared/types/entities';

type HttpEvent = {
  body?: string | null;
  pathParameters?: Record<string, string | undefined> | null;
};
export type AdminResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const tableName = process.env.FINDLY_TABLE_NAME ?? 'findly-local';
const photoBucket = process.env.FINDLY_PHOTO_BUCKET ?? 'findly-local-photos';
const endpoint = process.env.AWS_ENDPOINT_URL;
const options = endpoint
  ? { endpoint, region: 'eu-west-1' }
  : { region: 'eu-west-1' };
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(options));

function json(statusCode: number, body: unknown): AdminResult {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin':
        process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    },
    body: JSON.stringify(body),
  };
}
function error(statusCode: number, code: string, message: string): AdminResult {
  return json(statusCode, { code, message, requestId: randomUUID() });
}
function parseBody(event: HttpEvent): unknown | null {
  try {
    return event.body ? JSON.parse(event.body) : null;
  } catch {
    return null;
  }
}

export async function listAdminEvents(): Promise<AdminResult> {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': EVENT_LISTING_GSI2_PARTITION_KEY },
      ProjectionExpression:
        'eventId, #name, #date, retentionDays, createdAt, #status',
      ExpressionAttributeNames: {
        '#name': 'name',
        '#date': 'date',
        '#status': 'status',
      },
    }),
  );
  return json(200, { events: result.Items ?? [] });
}

export async function createAdminEvent(event: HttpEvent): Promise<AdminResult> {
  const parsed = createAdminEventSchema.safeParse(parseBody(event));
  if (!parsed.success)
    return error(400, 'INVALID_REQUEST', 'The event payload is invalid.');
  const eventId = `evt-${createHash('sha256')
    .update(`${parsed.data.name}\u0000${parsed.data.date}`)
    .digest('hex')
    .slice(0, 24)}`;
  const createdAt = new Date().toISOString();
  const entity: EventEntity &
    ReturnType<typeof eventKey> &
    ReturnType<typeof eventListingGsi2Key> = {
    ...eventKey(eventId),
    ...eventListingGsi2Key(parsed.data.date, eventId),
    eventId,
    ...parsed.data,
    createdAt,
    status: 'OPEN',
  };
  try {
    await dynamo.send(
      new PutCommand({
        TableName: tableName,
        Item: entity,
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  } catch (caught) {
    if (
      (caught as { name?: string }).name === 'ConditionalCheckFailedException'
    )
      return json(200, { eventId });
    throw caught;
  }
  return json(201, { eventId });
}

export async function createPhotoUploads(
  event: HttpEvent,
): Promise<AdminResult> {
  const eventId = event.pathParameters?.eventId;
  const parsed = photoUploadRequestSchema.safeParse(parseBody(event));
  if (!eventId || !parsed.success)
    return error(400, 'INVALID_REQUEST', 'The upload request is invalid.');
  const existing = await dynamo.send(
    new GetCommand({
      TableName: tableName,
      Key: eventKey(eventId),
      ProjectionExpression: 'eventId',
    }),
  );
  if (!existing.Item?.eventId)
    return error(404, 'EVENT_NOT_FOUND', 'The event was not found.');
  const now = new Date();
  const ttl = toEpochSeconds(30 * 24 * 60 * 60, now);
  const uploads = await Promise.all(
    parsed.data.files.map(async () => {
      const photoId = randomUUID();
      const s3Key = eventPhotoObjectKey(eventId, photoId);
      const photo: PhotoEntity & ReturnType<typeof photoKey> = {
        ...photoKey(eventId, photoId),
        photoId,
        eventId,
        s3Key,
        ttl,
        uploadedAt: now.toISOString(),
      };
      await dynamo.send(
        new PutCommand({
          TableName: tableName,
          Item: photo,
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      const signed = await createPresignedUploadUrl({
        bucket: photoBucket,
        key: s3Key,
        contentType: 'image/jpeg',
      });
      return { photoId, ...signed };
    }),
  );
  return json(200, { uploads });
}
