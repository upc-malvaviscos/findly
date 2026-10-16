import { createHash, randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  createAdminEventSchema,
  photoUploadRequestSchema,
  updateAdminEventSchema,
} from '../shared/lib/validations';
import {
  eventKey,
  eventListingGsi2Key,
  EVENT_LISTING_GSI2_PARTITION_KEY,
  matchKey,
  matchMirrorKey,
  photoKey,
  photoMatchPartitionKey,
  toEpochSeconds,
} from '../shared/lib/dynamoKeys';
import { eventPhotoObjectKey } from '../shared/lib/s3Keys';
import { createPresignedUploadUrl } from './lib/presignedUpload';
import { isMissingResourceError } from './lib/awsErrors';
import { decodeCursor, encodeCursor } from './lib/pagination';
import {
  assertEventCollectionOrigin,
  deleteEventCollection,
  deleteEventObjects,
  deleteEventRecords,
  eventCleanupDeadline,
} from './lib/eventCleanup';
import {
  withRequestLog,
  type LambdaContextLike,
  type RequestIds,
} from './lib/logger';
import type { EventEntity, PhotoEntity } from '../shared/types/entities';

type HttpEvent = {
  body?: string | null;
  pathParameters?: Record<string, string | undefined> | null;
  queryStringParameters?: Record<string, string | undefined> | null;
  requestContext?: { requestId?: string } | null;
};
export type AdminResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const PHOTO_PAGE_SIZE = 20;

const tableName = process.env.FINDLY_TABLE_NAME ?? 'findly-local';
const photoBucket = process.env.FINDLY_PHOTO_BUCKET ?? 'findly-local-photos';
const endpoint = process.env.AWS_ENDPOINT_URL;
const options = endpoint
  ? { endpoint, region: 'eu-west-1' }
  : { region: 'eu-west-1' };
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(options));
const s3 = new S3Client({ ...options, forcePathStyle: Boolean(endpoint) });

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
function error(
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
): AdminResult {
  return json(statusCode, { code, message, requestId });
}
function noContent(): AdminResult {
  return { statusCode: 204, headers: {}, body: '' };
}
function parseBody(event: HttpEvent): unknown | null {
  try {
    return event.body ? JSON.parse(event.body) : null;
  } catch {
    return null;
  }
}
function idsOf(event: HttpEvent, context?: LambdaContextLike): RequestIds {
  return {
    requestId: event.requestContext?.requestId,
    awsRequestId: context?.awsRequestId,
  };
}

export async function listAdminEvents(
  event: HttpEvent = {},
  context?: LambdaContextLike,
): Promise<AdminResult> {
  return withRequestLog(
    'admin_list_events',
    idsOf(event, context),
    async () => {
      const result = await dynamo.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :pk',
          ExpressionAttributeValues: {
            ':pk': EVENT_LISTING_GSI2_PARTITION_KEY,
          },
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
    },
  );
}

export async function createAdminEvent(
  event: HttpEvent,
  context?: LambdaContextLike,
): Promise<AdminResult> {
  return withRequestLog(
    'admin_create_event',
    idsOf(event, context),
    async (request) => {
      const parsed = createAdminEventSchema.safeParse(parseBody(event));
      if (!parsed.success)
        return error(
          400,
          'INVALID_REQUEST',
          'The event payload is invalid.',
          request.correlationId,
        );
      const eventId = `evt-${createHash('sha256')
        .update(`${parsed.data.name}\u0000${parsed.data.date}`)
        .digest('hex')
        .slice(0, 24)}`;
      request.annotate({ eventId });
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
          (caught as { name?: string }).name ===
          'ConditionalCheckFailedException'
        )
          return json(200, { eventId });
        throw caught;
      }
      return json(201, { eventId });
    },
  );
}

export async function createPhotoUploads(
  event: HttpEvent,
  context?: LambdaContextLike,
): Promise<AdminResult> {
  return withRequestLog(
    'admin_create_photo_uploads',
    idsOf(event, context),
    async (request) => {
      const eventId = event.pathParameters?.eventId;
      const parsed = photoUploadRequestSchema.safeParse(parseBody(event));
      if (!eventId || !parsed.success)
        return error(
          400,
          'INVALID_REQUEST',
          'The upload request is invalid.',
          request.correlationId,
        );
      const existing = await dynamo.send(
        new GetCommand({
          TableName: tableName,
          Key: eventKey(eventId),
          ProjectionExpression: 'eventId, createdAt, retentionDays, #status',
          ExpressionAttributeNames: { '#status': 'status' },
          ConsistentRead: true,
        }),
      );
      if (!existing.Item?.eventId)
        return error(
          404,
          'EVENT_NOT_FOUND',
          'The event was not found.',
          request.correlationId,
        );
      const expiresAt =
        Date.parse(String(existing.Item.createdAt)) +
        Number(existing.Item.retentionDays) * 86400000;
      if (
        existing.Item.status !== 'OPEN' ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now()
      )
        return error(
          410,
          'EVENT_EXPIRED',
          'The event no longer accepts photo uploads.',
          request.correlationId,
        );
      // Annotated only once the event is known to exist: before that, eventId
      // is unvalidated client input and must not be logged.
      request.annotate({ eventId });
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
      request.annotate({ photoCount: uploads.length });
      return json(200, { uploads });
    },
  );
}

export async function updateAdminEvent(
  event: HttpEvent,
  context?: LambdaContextLike,
): Promise<AdminResult> {
  return withRequestLog(
    'admin_update_event',
    idsOf(event, context),
    async (request) => {
      const eventId = event.pathParameters?.eventId;
      const parsed = updateAdminEventSchema.safeParse(parseBody(event));
      if (!eventId || !parsed.success)
        return error(
          400,
          'INVALID_REQUEST',
          'The update payload is invalid.',
          request.correlationId,
        );
      request.annotate({ eventId });
      const sets: string[] = [];
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      if (parsed.data.name !== undefined) {
        sets.push('#name = :name');
        names['#name'] = 'name';
        values[':name'] = parsed.data.name;
      }
      if (parsed.data.date !== undefined) {
        // Keeps GSI2SK (date#eventId) in step so the admin/public listings
        // stay correctly ordered after an edit; retentionDays/expiresAt for
        // existing uploads/registrations is read live, nothing to migrate.
        sets.push('#date = :date', 'GSI2SK = :gsi2sk');
        names['#date'] = 'date';
        values[':date'] = parsed.data.date;
        values[':gsi2sk'] = eventListingGsi2Key(
          parsed.data.date,
          eventId,
        ).GSI2SK;
      }
      if (parsed.data.retentionDays !== undefined) {
        sets.push('retentionDays = :retentionDays');
        values[':retentionDays'] = parsed.data.retentionDays;
      }
      try {
        const updated = await dynamo.send(
          new UpdateCommand({
            TableName: tableName,
            Key: eventKey(eventId),
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ConditionExpression: 'attribute_exists(PK)',
            ReturnValues: 'ALL_NEW',
          }),
        );
        const attributes = updated.Attributes as Partial<EventEntity>;
        return json(200, {
          eventId,
          name: attributes.name,
          date: attributes.date,
          retentionDays: attributes.retentionDays,
          createdAt: attributes.createdAt,
          status: attributes.status,
        });
      } catch (caught) {
        if (
          (caught as { name?: string }).name ===
          'ConditionalCheckFailedException'
        )
          return error(
            404,
            'EVENT_NOT_FOUND',
            'The event was not found.',
            request.correlationId,
          );
        throw caught;
      }
    },
  );
}

export async function listEventPhotos(
  event: HttpEvent,
  context?: LambdaContextLike,
): Promise<AdminResult> {
  return withRequestLog(
    'admin_list_event_photos',
    idsOf(event, context),
    async (request) => {
      const eventId = event.pathParameters?.eventId;
      if (!eventId)
        return error(
          400,
          'INVALID_REQUEST',
          'An eventId is required.',
          request.correlationId,
        );
      const cursorParam = event.queryStringParameters?.cursor;
      let exclusiveStartKey: Record<string, unknown> | undefined;
      if (cursorParam !== undefined) {
        const decoded = decodeCursor(cursorParam);
        if (!decoded)
          return error(
            400,
            'INVALID_REQUEST',
            'The cursor is invalid.',
            request.correlationId,
          );
        exclusiveStartKey = decoded;
      }
      const existing = await dynamo.send(
        new GetCommand({
          TableName: tableName,
          Key: eventKey(eventId),
          ProjectionExpression: 'eventId',
        }),
      );
      if (!existing.Item?.eventId)
        return error(
          404,
          'EVENT_NOT_FOUND',
          'The event was not found.',
          request.correlationId,
        );
      request.annotate({ eventId });
      const page = await dynamo.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': eventKey(eventId).PK,
            ':prefix': 'PHOTO#',
          },
          ProjectionExpression: 'photoId, uploadedAt',
          Limit: PHOTO_PAGE_SIZE,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      const photos = (page.Items ?? []) as Array<
        Pick<PhotoEntity, 'photoId' | 'uploadedAt'>
      >;
      return json(200, {
        photos,
        ...(page.LastEvaluatedKey
          ? { nextCursor: encodeCursor(page.LastEvaluatedKey) }
          : {}),
      });
    },
  );
}

// DynamoDB's hard limit per BatchWriteItem call.
const DYNAMO_BATCH_WRITE_LIMIT = 25;

// Deletes any number of keys with one BatchWriteCommand per 25-item chunk
// instead of one DeleteCommand per key: a photo's match cleanup can touch
// hundreds of items, and that round-trip count is what blew past
// delete_photo's Lambda timeout under realistic match volume.
async function batchDeleteItems(
  keys: Array<Record<string, unknown>>,
): Promise<void> {
  const chunks: Array<Array<Record<string, unknown>>> = [];
  for (let start = 0; start < keys.length; start += DYNAMO_BATCH_WRITE_LIMIT)
    chunks.push(keys.slice(start, start + DYNAMO_BATCH_WRITE_LIMIT));

  await Promise.all(
    chunks.map(async (chunk) => {
      let requestItems: Array<{
        DeleteRequest: { Key: Record<string, unknown> };
      }> = chunk.map((Key) => ({ DeleteRequest: { Key } }));
      while (requestItems.length > 0) {
        const response = await dynamo.send(
          new BatchWriteCommand({
            RequestItems: { [tableName]: requestItems },
          }),
        );
        requestItems =
          (response.UnprocessedItems?.[tableName] as typeof requestItems) ?? [];
      }
    }),
  );
}

export async function deleteEventPhoto(
  event: HttpEvent,
  context?: LambdaContextLike,
): Promise<AdminResult> {
  return withRequestLog(
    'admin_delete_event_photo',
    idsOf(event, context),
    async (request) => {
      const eventId = event.pathParameters?.eventId;
      const photoId = event.pathParameters?.photoId;
      if (!eventId || !photoId)
        return error(
          400,
          'INVALID_REQUEST',
          'An eventId and photoId are required.',
          request.correlationId,
        );
      request.annotate({ eventId });

      // ADR-022 mirror item: finds every REG#.../MATCH#{photoId} this photo
      // produced by key, no Scan. Matches written before that item existed
      // (no persistent demo has ever held real data) have no mirror to find
      // here and are a documented gap, not handled by this loop.
      let matchCursor: Record<string, unknown> | undefined;
      let matchesDeleted = 0;
      do {
        const page = await dynamo.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: {
              ':pk': photoMatchPartitionKey(eventId, photoId),
            },
            ProjectionExpression: 'registrationId',
            ConsistentRead: true,
            ExclusiveStartKey: matchCursor,
          }),
        );
        const registrationIds = (page.Items ?? [])
          .map((item) => item.registrationId)
          .filter((id): id is string => typeof id === 'string');
        await batchDeleteItems(
          registrationIds.flatMap((registrationId) => [
            matchKey(registrationId, photoId),
            matchMirrorKey(eventId, photoId, registrationId),
          ]),
        );
        matchesDeleted += registrationIds.length;
        matchCursor = page.LastEvaluatedKey as
          Record<string, unknown> | undefined;
      } while (matchCursor);

      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: photoBucket,
            Key: eventPhotoObjectKey(eventId, photoId),
          }),
        );
      } catch (deleteError) {
        if (!isMissingResourceError(deleteError)) throw deleteError;
      }

      await dynamo.send(
        new DeleteCommand({
          TableName: tableName,
          Key: photoKey(eventId, photoId),
        }),
      );

      request.info('admin_event_photo_deleted', { eventId, matchesDeleted });
      return noContent();
    },
  );
}

export async function deleteAdminEvent(
  event: HttpEvent,
  context?: LambdaContextLike,
): Promise<AdminResult> {
  return withRequestLog(
    'admin_delete_event',
    idsOf(event, context),
    async (request) => {
      const eventId = event.pathParameters?.eventId;
      if (!eventId)
        return error(
          400,
          'INVALID_REQUEST',
          'An eventId is required.',
          request.correlationId,
        );
      request.annotate({ eventId });

      const existing = await dynamo.send(
        new GetCommand({
          TableName: tableName,
          Key: eventKey(eventId),
          ProjectionExpression: 'cleanupAfter',
          ConsistentRead: true,
        }),
      );
      // Idempotent: a previous call, or the cron, may have already finished.
      if (!existing.Item) return noContent();

      // Same ADR-013 barrier the cron uses, anchored to now instead of the
      // event's retention expiry: blocks new registrations/uploads
      // immediately (status leaves 'OPEN'), but the Rekognition collection
      // and the bare Event row are only destroyed once any upload from just
      // before this call has had time to be delivered and reconciled — up to
      // ~6h later, same as the cron, via the next scheduled run.
      const deadline = eventCleanupDeadline(
        Math.floor(Date.now() / 1000),
        existing.Item.cleanupAfter as number | undefined,
      );
      try {
        await dynamo.send(
          new UpdateCommand({
            TableName: tableName,
            Key: eventKey(eventId),
            UpdateExpression: 'SET cleanupAfter = :after, #status = :closed',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':after': deadline,
              ':closed': 'CLOSED',
            },
            ConditionExpression:
              'attribute_exists(PK) AND (attribute_not_exists(cleanupAfter) OR cleanupAfter <= :after)',
          }),
        );
      } catch (markError) {
        if (
          (markError as { name?: string }).name !==
          'ConditionalCheckFailedException'
        )
          throw markError;
        // Already marked by a concurrent call (or with a later deadline
        // already in place): proceed with cleanup regardless, it is
        // idempotent either way.
      }

      await assertEventCollectionOrigin(eventId);
      await deleteEventObjects(eventId);
      const complete = await deleteEventRecords(eventId);
      if (complete && deadline <= Math.floor(Date.now() / 1000)) {
        await deleteEventCollection(eventId);
        await dynamo.send(
          new DeleteCommand({ TableName: tableName, Key: eventKey(eventId) }),
        );
      }

      request.info('admin_event_deleted', {
        eventId,
        cleanupComplete: complete,
      });
      return noContent();
    },
  );
}
