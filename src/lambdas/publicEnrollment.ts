import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  eventKey,
  galleryTokenKey,
  registrationKey,
} from '../shared/lib/dynamoKeys';
import { selfieObjectKey } from '../shared/lib/s3Keys';
import { enrollmentFormSchema } from '../shared/lib/validations';
import { createPresignedUploadUrl } from './lib/presignedUpload';
import { withRequestLog, type LambdaContextLike } from './lib/logger';
import type {
  EventEntity,
  GalleryTokenEntity,
  RegistrationEntity,
} from '../shared/types/entities';
type HttpEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  pathParameters?: Record<string, string | undefined> | null;
  requestContext?: { requestId?: string } | null;
};
const endpoint = process.env.AWS_ENDPOINT_URL;
const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'eu-west-1',
    ...(endpoint ? { endpoint } : {}),
  }),
);
const tableName = process.env.FINDLY_TABLE_NAME ?? 'findly-local';
const bucket = process.env.FINDLY_PHOTO_BUCKET ?? 'findly-local-photos';
const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
export async function createPublicRegistration(
  event: HttpEvent,
  context?: LambdaContextLike,
) {
  return withRequestLog(
    'public_registration',
    {
      requestId: event.requestContext?.requestId,
      awsRequestId: context?.awsRequestId,
    },
    async (request) => {
      const fail = (statusCode: number, code: string) =>
        json(statusCode, {
          code,
          message: code,
          requestId: request.correlationId,
        });
      let body: unknown;
      try {
        body = JSON.parse(event.body ?? 'null');
      } catch {
        return fail(400, 'INVALID_REQUEST');
      }
      const parsed = enrollmentFormSchema.safeParse(body);
      const eventId = event.pathParameters?.eventId;
      if (!parsed.success || !eventId) return fail(400, 'INVALID_REQUEST');
      const metadata = (
        await db.send(
          new GetCommand({
            TableName: tableName,
            Key: eventKey(eventId),
            ConsistentRead: true,
          }),
        )
      ).Item as EventEntity | undefined;
      if (!metadata || metadata.status !== 'OPEN')
        return fail(404, 'EVENT_NOT_FOUND');
      const expires =
        Date.parse(metadata.createdAt) + metadata.retentionDays * 86400000;
      if (!Number.isFinite(expires) || expires <= Date.now())
        return fail(410, 'EVENT_EXPIRED');
      const registrationId = randomUUID();
      const galleryToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(galleryToken).digest('hex');
      const ttl = Math.floor(expires / 1000);
      const key = selfieObjectKey(eventId, registrationId);
      const upload = await createPresignedUploadUrl({
        bucket,
        key,
        contentType: 'image/jpeg',
      });
      const registration: RegistrationEntity = {
        eventId,
        registrationId,
        tokenHash,
        status: 'UPLOAD_PENDING',
        consentTimestamp: new Date().toISOString(),
        selfieS3Key: key,
        ttl,
        ...(parsed.data.email ? { email: parsed.data.email } : {}),
      };
      const token: GalleryTokenEntity = {
        eventId,
        registrationId,
        tokenHash,
        ttl,
        expiresAt: new Date(expires).toISOString(),
      };
      await db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName: tableName,
                Key: eventKey(eventId),
                ConditionExpression: '#status = :open',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':open': 'OPEN' },
              },
            },
            {
              Put: {
                TableName: tableName,
                Item: {
                  ...registrationKey(eventId, registrationId),
                  ...registration,
                },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Put: {
                TableName: tableName,
                Item: { ...galleryTokenKey(tokenHash), ...token },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
          ],
        }),
      );
      request.annotate({ eventId });
      return json(201, { registrationId, galleryToken, ...upload });
    },
  );
}
export async function getPublicRegistrationStatus(
  event: HttpEvent,
  context?: LambdaContextLike,
) {
  return withRequestLog(
    'public_registration_status',
    {
      requestId: event.requestContext?.requestId,
      awsRequestId: context?.awsRequestId,
    },
    async (request) => {
      const fail = (statusCode: number, code: string) =>
        json(statusCode, {
          code,
          message: code,
          requestId: request.correlationId,
        });
      const token = Object.entries(event.headers ?? {}).find(
        ([key]) => key.toLowerCase() === 'x-gallery-token',
      )?.[1];
      const registrationId = event.pathParameters?.registrationId;
      if (!token || !registrationId) return fail(400, 'INVALID_REQUEST');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const grant = (
        await db.send(
          new GetCommand({
            TableName: tableName,
            Key: galleryTokenKey(tokenHash),
            ConsistentRead: true,
          }),
        )
      ).Item as GalleryTokenEntity | undefined;
      if (!grant || grant.registrationId !== registrationId)
        return fail(404, 'REGISTRATION_NOT_FOUND');
      if (Date.parse(grant.expiresAt) <= Date.now())
        return fail(410, 'REGISTRATION_EXPIRED');
      const registration = (
        await db.send(
          new GetCommand({
            TableName: tableName,
            Key: registrationKey(grant.eventId, registrationId),
            ConsistentRead: true,
          }),
        )
      ).Item as RegistrationEntity | undefined;
      if (!registration) return fail(404, 'REGISTRATION_NOT_FOUND');
      return json(200, { registrationId, status: registration.status });
    },
  );
}
