import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  GetSuppressedDestinationCommand,
  SendEmailCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';
import {
  eventKey,
  galleryTokenKey,
  photoKey,
  registrationKey,
  registrationPartitionKey,
} from '../shared/lib/dynamoKeys';
import type { GalleryEmailOperation } from '../shared/types/api';
import {
  withRequestLog,
  type LambdaContextLike,
  emitLog,
  resolveCorrelationId,
} from './lib/logger';

const options = {
  region: 'eu-west-1',
  ...(process.env.AWS_ENDPOINT_URL
    ? { endpoint: process.env.AWS_ENDPOINT_URL }
    : {}),
};
const db = DynamoDBDocumentClient.from(new DynamoDBClient(options));
// SES has no idempotency token: hidden SDK retries can duplicate accepted mail.
const ses = new SESv2Client({ ...options, maxAttempts: 1 });
const sqs = new SQSClient(options);
const s3 = new S3Client({
  ...options,
  forcePathStyle: Boolean(options.endpoint),
});
const table = () => process.env.FINDLY_TABLE_NAME ?? 'findly-local';
const operationKey = (eventId: string, operationId: string) => ({
  PK: `EVENT#${eventId}`,
  SK: `EMAIL#${operationId}`,
});
const recipientKey = (registrationId: string, operationId: string) => ({
  PK: registrationPartitionKey(registrationId),
  SK: `EMAIL#${operationId}`,
});
const id = z.string().uuid();
const messageSchema = z.object({
  eventId: z.string().min(1).max(128),
  operationId: id,
});
const terminal = [
  'accepted',
  'skipped',
  'missingEmail',
  'failed',
  'uncertain',
] as const;
type Outcome = (typeof terminal)[number];
type RecordItem = Record<string, unknown>;
type Operation = GalleryEmailOperation & {
  ttl: number;
  revision: number;
  updatedAt?: number;
  cursor?: RecordItem;
};
type HttpEvent = {
  body?: string | null;
  pathParameters?: Record<string, string | undefined> | null;
  requestContext?: {
    requestId?: string;
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
  };
};
function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
async function get(Key: { PK: string; SK: string }) {
  return (
    await db.send(
      new GetCommand({ TableName: table(), Key, ConsistentRead: true }),
    )
  ).Item;
}
function expiry(event: RecordItem) {
  return Math.floor(
    (Date.parse(String(event.createdAt)) +
      Number(event.retentionDays) * 86400000) /
      1000,
  );
}
function activeEvent(event: RecordItem | undefined) {
  return Boolean(
    event &&
    event.status === 'OPEN' &&
    !event.erasureRequestedAt &&
    Number.isFinite(expiry(event)) &&
    expiry(event) > Date.now() / 1000,
  );
}
function publicStatus(op: Operation): GalleryEmailOperation {
  return {
    operationId: op.operationId,
    status:
      op.status === 'RUNNING' &&
      op.updatedAt &&
      op.updatedAt < Date.now() - 600000
        ? 'STALLED'
        : op.status,
    accepted: op.accepted,
    skipped: op.skipped,
    missingEmail: op.missingEmail,
    failed: op.failed,
    uncertain: op.uncertain,
    bounced: op.bounced,
    complained: op.complained,
  };
}
async function enqueue(eventId: string, operationId: string) {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.FINDLY_EMAIL_QUEUE_URL,
      MessageBody: JSON.stringify({ eventId, operationId }),
      MessageGroupId: 'gallery-email',
      MessageDeduplicationId: randomUUID(),
    }),
  );
}
export async function requestGalleryEmail(event: HttpEvent) {
  return withRequestLog(
    'gallery_email_request',
    { requestId: event.requestContext?.requestId },
    async () => {
      if (!event.requestContext?.authorizer?.jwt?.claims?.sub)
        return json(401, { code: 'UNAUTHORIZED' });
      const eventId = event.pathParameters?.eventId;
      let body: unknown;
      try {
        body = JSON.parse(event.body ?? 'null');
      } catch {
        return json(400, { code: 'INVALID_REQUEST' });
      }
      const parsed = z.object({ operationId: id }).strict().safeParse(body);
      if (!eventId || !parsed.success)
        return json(400, { code: 'INVALID_REQUEST' });
      if (!process.env.FINDLY_EMAIL_QUEUE_URL)
        return json(503, { code: 'EMAIL_NOT_CONFIGURED' });
      const existingEvent = await get(eventKey(eventId));
      if (!existingEvent) return json(404, { code: 'EVENT_NOT_FOUND' });
      if (!activeEvent(existingEvent))
        return json(410, { code: 'EVENT_EXPIRED' });
      const { operationId } = parsed.data;
      let op = (await get(operationKey(eventId, operationId))) as
        Operation | undefined;
      if (!op) {
        op = {
          operationId,
          status: 'RUNNING',
          revision: 0,
          updatedAt: Date.now(),
          ttl: expiry(existingEvent),
          accepted: 0,
          skipped: 0,
          missingEmail: 0,
          failed: 0,
          uncertain: 0,
          bounced: 0,
          complained: 0,
        };
        try {
          await db.send(
            new PutCommand({
              TableName: table(),
              Item: { ...operationKey(eventId, operationId), ...op },
              ConditionExpression: 'attribute_not_exists(PK)',
            }),
          );
        } catch (error) {
          if (
            (error as { name?: string }).name !==
            'ConditionalCheckFailedException'
          )
            throw error;
          op = (await get(operationKey(eventId, operationId))) as Operation;
        }
      }
      // Recover the durable creation / queue-write gap on the same client retry.
      if (op.status === 'RUNNING') await enqueue(eventId, operationId);
      return json(202, publicStatus(op));
    },
  );
}
export async function getGalleryEmailStatus(event: HttpEvent) {
  if (!event.requestContext?.authorizer?.jwt?.claims?.sub)
    return json(401, { code: 'UNAUTHORIZED' });
  const eventId = event.pathParameters?.eventId;
  const operationId = event.pathParameters?.operationId;
  if (!eventId || !id.safeParse(operationId).success)
    return json(400, { code: 'INVALID_REQUEST' });
  const op = (await get(operationKey(eventId, String(operationId)))) as
    Operation | undefined;
  return op
    ? json(200, publicStatus(op))
    : json(404, { code: 'EMAIL_OPERATION_NOT_FOUND' });
}

async function eligible(
  eventId: string,
  registrationId: string,
): Promise<
  | {
      event: RecordItem;
      registration: RecordItem;
      photoId: string;
      ttl: number;
    }
  | Outcome
> {
  const event = await get(eventKey(eventId));
  const registration = await get(registrationKey(eventId, registrationId));
  const ttl = Math.min(Number(registration?.ttl), event ? expiry(event) : 0);
  if (
    !activeEvent(event) ||
    !registration?.consentTimestamp ||
    registration.erasureRequestedAt ||
    registration.status !== 'ENROLLED' ||
    !Number.isFinite(ttl) ||
    ttl <= Date.now() / 1000
  )
    return 'skipped';
  if (!z.string().trim().email().safeParse(registration.email).success)
    return 'missingEmail';
  let cursor: RecordItem | undefined;
  do {
    const page = await db.send(
      new QueryCommand({
        TableName: table(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': registrationPartitionKey(registrationId),
          ':prefix': 'MATCH#',
        },
        ConsistentRead: true,
        ExclusiveStartKey: cursor,
      }),
    );
    for (const match of page.Items ?? []) {
      if (
        match.eventId !== eventId ||
        typeof match.photoId !== 'string' ||
        !Number.isFinite(Number(match.ttl)) ||
        Number(match.ttl) <= Date.now() / 1000
      )
        continue;
      const photo = await get(photoKey(eventId, match.photoId));
      if (
        !photo ||
        photo.erasureRequestedAt ||
        !Number.isFinite(Number(photo.ttl)) ||
        Number(photo.ttl) <= Date.now() / 1000 ||
        typeof photo.s3Key !== 'string' ||
        !photo.s3Key.startsWith(`events/${eventId}/photos/`)
      )
        continue;
      try {
        await s3.send(
          new HeadObjectCommand({
            Bucket: process.env.FINDLY_PHOTO_BUCKET ?? 'findly-local-photos',
            Key: photo.s3Key,
          }),
        );
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode === 404
        )
          continue;
        throw error;
      }
      return { event: event!, registration, photoId: match.photoId, ttl };
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return 'skipped';
}
function htmlEscape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}
export function galleryEmailContent(
  name: string,
  url: string,
  expiresAt: string,
) {
  const text = `Tus fotografías de ${name}\n\nAbre tu galería privada: ${url}\nEl enlace caduca el ${expiresAt}.\nCompartirlo también permite borrar tu inscripción.\nPuedes retirar tu consentimiento desde la galería.`;
  return {
    Subject: { Data: 'Findly: tu galería privada', Charset: 'UTF-8' },
    Body: {
      Text: { Data: text, Charset: 'UTF-8' },
      Html: {
        Data: `<p>Tus fotografías de ${htmlEscape(name)}</p><p><a href="${htmlEscape(url)}">Abrir galería privada</a></p><p>El enlace caduca el ${htmlEscape(expiresAt)}.</p><p>Compartirlo también permite borrar tu inscripción. Puedes retirar tu consentimiento desde la galería.</p>`,
        Charset: 'UTF-8',
      },
    },
  };
}
async function setRecipient(
  registrationId: string,
  operationId: string,
  outcome: Outcome,
) {
  try {
    await db.send(
      new UpdateCommand({
        TableName: table(),
        Key: recipientKey(registrationId, operationId),
        UpdateExpression: 'SET #state = :state',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: { ':state': outcome },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name !== 'ConditionalCheckFailedException')
      throw error;
    // Concurrent erasure removed the recipient. Never recreate personal state.
  }
}
async function sendRecipient(
  eventId: string,
  operationId: string,
  registrationId: string,
): Promise<Outcome> {
  const key = recipientKey(registrationId, operationId);
  const previous = await get(key);
  if (terminal.includes(previous?.state as Outcome))
    return previous!.state as Outcome;
  if (previous?.state === 'SENDING') {
    await setRecipient(registrationId, operationId, 'uncertain');
    return 'uncertain';
  }
  const candidate = await eligible(eventId, registrationId);
  if (typeof candidate === 'string') return candidate;
  const email = String(candidate.registration.email).trim();
  try {
    await ses.send(
      new GetSuppressedDestinationCommand({ EmailAddress: email }),
    );
    return 'skipped';
  } catch (error) {
    if ((error as { name?: string }).name !== 'NotFoundException') throw error;
  }
  const origin = new URL(process.env.FINDLY_GALLERY_ORIGIN ?? '');
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('InvalidGalleryOrigin');
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const now = Math.floor(Date.now() / 1000);
  const tokenEntity = {
    tokenHash,
    eventId,
    registrationId,
    ttl: candidate.ttl,
    expiresAt: new Date(candidate.ttl * 1000).toISOString(),
    requireRegistration: true,
  };
  try {
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: table(),
              Key: eventKey(eventId),
              ConditionExpression:
                '#status = :open AND attribute_not_exists(erasureRequestedAt) AND createdAt = :created AND retentionDays = :days',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':open': 'OPEN',
                ':created': candidate.event.createdAt,
                ':days': candidate.event.retentionDays,
              },
            },
          },
          {
            ConditionCheck: {
              TableName: table(),
              Key: registrationKey(eventId, registrationId),
              ConditionExpression:
                '#status = :enrolled AND attribute_not_exists(erasureRequestedAt) AND ttl > :now AND email = :email AND consentTimestamp = :consent',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':enrolled': 'ENROLLED',
                ':now': now,
                ':email': candidate.registration.email,
                ':consent': candidate.registration.consentTimestamp,
              },
            },
          },
          {
            ConditionCheck: {
              TableName: table(),
              Key: photoKey(eventId, candidate.photoId),
              ConditionExpression:
                'attribute_exists(PK) AND attribute_not_exists(erasureRequestedAt) AND ttl > :now',
              ExpressionAttributeValues: { ':now': now },
            },
          },
          {
            Put: {
              TableName: table(),
              Item: { ...key, state: 'SENDING', ttl: candidate.ttl },
              ConditionExpression:
                'attribute_not_exists(PK) OR #state = :retry',
              ExpressionAttributeNames: { '#state': 'state' },
              ExpressionAttributeValues: { ':retry': 'RETRY' },
            },
          },
          {
            Put: {
              TableName: table(),
              Item: { ...galleryTokenKey(tokenHash), ...tokenEntity },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: table(),
              Item: {
                PK: registrationPartitionKey(registrationId),
                SK: `TOKEN#${tokenHash}`,
                tokenHash,
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name !== 'TransactionCanceledException')
      throw error;
    throw new Error('EmailClaimConflict');
  }
  // Check again at the external side-effect boundary. SES is not transactional
  // with DynamoDB; revocation after this check cannot cancel an in-flight call.
  const rechecked = await eligible(eventId, registrationId);
  if (typeof rechecked === 'string') {
    await setRecipient(registrationId, operationId, rechecked);
    return rechecked;
  }
  await delay(1100);
  const finalCandidate = await eligible(eventId, registrationId);
  if (typeof finalCandidate === 'string') {
    await setRecipient(registrationId, operationId, finalCandidate);
    return finalCandidate;
  }
  if (String(finalCandidate.registration.email).trim() !== email) {
    await setRecipient(registrationId, operationId, 'skipped');
    return 'skipped';
  }
  let outcome: Outcome;
  try {
    const result = await ses.send(
      new SendEmailCommand({
        FromEmailAddress: process.env.FINDLY_EMAIL_FROM,
        ConfigurationSetName: process.env.FINDLY_EMAIL_CONFIGURATION_SET,
        Destination: { ToAddresses: [email] },
        Content: {
          Simple: galleryEmailContent(
            String(rechecked.event.name),
            `${origin.origin}/gallery?token=${token}`,
            tokenEntity.expiresAt,
          ),
        },
        EmailTags: [
          { Name: 'eventId', Value: eventId },
          { Name: 'operationId', Value: operationId },
          { Name: 'registrationId', Value: registrationId },
        ],
      }),
    );
    outcome = result.MessageId ? 'accepted' : 'uncertain';
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === 'TooManyRequestsException') {
      await db.send(
        new UpdateCommand({
          TableName: table(),
          Key: key,
          UpdateExpression: 'SET #state = :retry',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: { ':retry': 'RETRY' },
        }),
      );
      throw new Error('EmailRateLimited');
    }
    outcome = [
      'MessageRejected',
      'MailFromDomainNotVerifiedException',
      'BadRequestException',
      'AccountSuspendedException',
      'SendingPausedException',
    ].includes(name ?? '')
      ? 'failed'
      : 'uncertain';
  }
  await setRecipient(registrationId, operationId, outcome);
  return outcome;
}
async function processWork(
  event: { Records: Array<{ body: string }> },
  correlationId: string,
) {
  // FIFO uses one group for all operations: total sending rate is bounded.
  for (const record of event.Records) {
    const { eventId, operationId } = messageSchema.parse(
      JSON.parse(record.body),
    );
    const op = (await get(operationKey(eventId, operationId))) as
      Operation | undefined;
    if (!op || op.status === 'COMPLETED') continue;
    const page = await db.send(
      new QueryCommand({
        TableName: table(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': eventKey(eventId).PK,
          ':prefix': 'REG#',
        },
        ConsistentRead: true,
        ExclusiveStartKey: op.cursor,
        Limit: 1,
      }),
    );
    let outcome: Outcome | undefined;
    const registrationId = page.Items?.[0]?.registrationId;
    if (typeof registrationId === 'string')
      outcome = await sendRecipient(eventId, operationId, registrationId);
    if (outcome)
      emitLog('INFO', `gallery_email_${outcome}`, correlationId, { eventId });
    // Queue the next wake-up before advancing the checkpoint. If the write
    // fails, FIFO retries and recipient state prevents another SES call.
    if (page.LastEvaluatedKey) await enqueue(eventId, operationId);
    await db.send(
      new UpdateCommand({
        TableName: table(),
        Key: operationKey(eventId, operationId),
        UpdateExpression: `SET #status = :status, revision = :next, updatedAt = :updatedAt${page.LastEvaluatedKey ? ', #cursor = :cursor' : ''}${outcome ? ' ADD #count :one' : ''}`,
        ConditionExpression: 'attribute_exists(PK) AND revision = :revision',
        ExpressionAttributeNames: {
          '#status': 'status',
          ...(page.LastEvaluatedKey ? { '#cursor': 'cursor' } : {}),
          ...(outcome ? { '#count': outcome } : {}),
        },
        ExpressionAttributeValues: {
          ':status': page.LastEvaluatedKey ? 'RUNNING' : 'COMPLETED',
          ':next': op.revision + 1,
          ':updatedAt': Date.now(),
          ':revision': op.revision,
          ...(page.LastEvaluatedKey
            ? { ':cursor': page.LastEvaluatedKey }
            : {}),
          ...(outcome ? { ':one': 1 } : {}),
        },
      }),
    );
  }
}

export async function processGalleryEmail(
  event: { Records: Array<{ body: string }> },
  context?: LambdaContextLike,
) {
  const correlationId = resolveCorrelationId(context?.awsRequestId);
  const startedAt = Date.now();
  try {
    await processWork(event, correlationId);
    emitLog('INFO', 'gallery_email_work', correlationId, {
      recordCount: event.Records.length,
      durationMs: Date.now() - startedAt,
    });
  } catch {
    emitLog('ERROR', 'gallery_email_work_failed', correlationId, {
      errorName: 'GalleryEmailProcessingFailed',
      durationMs: Date.now() - startedAt,
    });
    throw new Error('GalleryEmailProcessingFailed');
  }
}
