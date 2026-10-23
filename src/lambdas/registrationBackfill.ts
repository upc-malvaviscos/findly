import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { eventKey, registrationKey } from '../shared/lib/dynamoKeys';
import { dynamo, matchPhoto, tableName, type MatchStep } from './lib/matching';
import {
  emitLog,
  errorNameOf,
  resolveCorrelationId,
  type LambdaContextLike,
} from './lib/logger';
import type { PhotoEntity, RegistrationEntity } from '../shared/types/entities';

const photoBucket = process.env.FINDLY_PHOTO_BUCKET ?? 'findly-local-photos';
const sqsOptions = {
  region: 'eu-west-1',
  ...(process.env.AWS_ENDPOINT_URL
    ? { endpoint: process.env.AWS_ENDPOINT_URL }
    : {}),
};
const sqs = new SQSClient(sqsOptions);

const PHOTO_SORT_KEY_PREFIX = 'PHOTO#';
// Bounds each invocation to a predictable number of Rekognition calls; the
// continuation message (below) carries the rest of the event's photos.
const PHOTO_PAGE_SIZE = 25;

const cursorSchema = z.object({ PK: z.string(), SK: z.string() });
const jobSchema = z.object({
  eventId: z.string().min(1).max(128),
  registrationId: z.string().uuid(),
  cursor: cursorSchema.optional(),
});
type BackfillJob = z.infer<typeof jobSchema>;

type SqsRecord = { messageId: string; body: string };
export type RegistrationBackfillEvent = { Records: SqsRecord[] };
export type RegistrationBackfillResult = {
  batchItemFailures: Array<{ itemIdentifier: string }>;
};

function parseJob(body: string): BackfillJob | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const result = jobSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

// The triggering registration must still be the enrolled, non-revoked owner
// of its FaceId before spending Rekognition calls on its behalf. This is an
// optimization, not the correctness guarantee: matchPhoto re-resolves and
// re-validates the registration for every face it finds (via
// findRegistrationForFace and writeMatch's own condition check), so a
// registration revoked between pages still cannot resurrect a match.
async function registrationStillEnrolled(
  eventId: string,
  registrationId: string,
): Promise<boolean> {
  const result = await dynamo.send(
    new GetCommand({
      TableName: tableName,
      Key: registrationKey(eventId, registrationId),
      ConsistentRead: true,
    }),
  );
  const item = result.Item as RegistrationEntity | undefined;
  return Boolean(
    item &&
    item.status === 'ENROLLED' &&
    item.faceId &&
    !('erasureRequestedAt' in item) &&
    item.ttl > Math.floor(Date.now() / 1000),
  );
}

async function enqueueContinuation(
  job: BackfillJob,
  cursor: Record<string, unknown>,
): Promise<void> {
  const queueUrl = process.env.FINDLY_BACKFILL_QUEUE_URL;
  if (!queueUrl) throw new Error('BACKFILL_QUEUE_URL_MISSING');
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ ...job, cursor }),
    }),
  );
}

async function processJob(
  job: BackfillJob,
  onFailure: (step: MatchStep) => void,
): Promise<number> {
  if (!(await registrationStillEnrolled(job.eventId, job.registrationId)))
    return 0;

  const page = await dynamo.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': eventKey(job.eventId).PK,
        ':prefix': PHOTO_SORT_KEY_PREFIX,
      },
      ConsistentRead: true,
      Limit: PHOTO_PAGE_SIZE,
      ExclusiveStartKey: job.cursor,
    }),
  );

  const now = Math.floor(Date.now() / 1000);
  let photoCount = 0;
  for (const raw of page.Items ?? []) {
    const photo = raw as PhotoEntity & { SK: string };
    if (
      'deletedAt' in photo ||
      typeof photo.ttl !== 'number' ||
      photo.ttl <= now ||
      typeof photo.s3Key !== 'string' ||
      !photo.s3Key
    )
      continue;
    const photoId = photo.SK.slice(PHOTO_SORT_KEY_PREFIX.length);
    await matchPhoto(photoBucket, job.eventId, photoId, photo.s3Key, onFailure);
    photoCount += 1;
  }

  if (page.LastEvaluatedKey)
    await enqueueContinuation(job, page.LastEvaluatedKey);
  return photoCount;
}

export async function registrationBackfill(
  event: RegistrationBackfillEvent,
  context?: LambdaContextLike,
): Promise<RegistrationBackfillResult> {
  const batchStartedAt = Date.now();
  const batchId = resolveCorrelationId(context?.awsRequestId);
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    const correlationId = resolveCorrelationId(
      record.messageId,
      context?.awsRequestId,
    );
    const job = parseJob(record.body);
    if (!job) continue; // Malformed message: nothing to retry productively.
    let failedStep: MatchStep | undefined;
    try {
      const photoCount = await processJob(job, (step) => {
        failedStep = step;
      });
      emitLog('INFO', 'registration_backfill_processed', correlationId, {
        eventId: job.eventId,
        photoCount,
      });
    } catch (caught) {
      emitLog('ERROR', 'registration_backfill_failed', correlationId, {
        eventId: job.eventId,
        step: failedStep,
        errorName: errorNameOf(caught),
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  emitLog('INFO', 'registration_backfill_batch_processed', batchId, {
    recordCount: event.Records.length,
    failedCount: batchItemFailures.length,
    durationMs: Date.now() - batchStartedAt,
  });

  return { batchItemFailures };
}
