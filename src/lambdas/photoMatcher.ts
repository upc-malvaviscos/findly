import { parseEventPhotoObjectKey } from '../shared/lib/s3Keys';
import {
  emitLog,
  errorNameOf,
  resolveCorrelationId,
  type LambdaContextLike,
} from './lib/logger';
import { matchPhoto, type MatchStep } from './lib/matching';

type S3EventRecord = {
  eventName?: string;
  s3?: { bucket?: { name?: string }; object?: { key?: string } };
};

type SqsRecord = { messageId: string; body: string };

export type PhotoMatcherEvent = { Records: SqsRecord[] };

export type PhotoMatcherResult = {
  batchItemFailures: Array<{ itemIdentifier: string }>;
};

function decodeObjectKey(rawKey: string): string {
  return decodeURIComponent(rawKey.replace(/\+/g, ' '));
}

function parseS3PhotoEvents(
  body: string,
): Array<{ bucket: string; key: string; eventId: string; photoId: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const records = (parsed as { Records?: S3EventRecord[] }).Records ?? [];
  const parsedRecords: Array<{
    bucket: string;
    key: string;
    eventId: string;
    photoId: string;
  }> = [];
  for (const record of records) {
    const bucket = record.s3?.bucket?.name;
    const rawKey = record.s3?.object?.key;
    if (!bucket || !rawKey) continue;
    const key = decodeObjectKey(rawKey);
    const parsedKey = parseEventPhotoObjectKey(key);
    if (!parsedKey) continue;
    parsedRecords.push({ bucket, key, ...parsedKey });
  }
  return parsedRecords;
}

export async function photoMatcher(
  event: PhotoMatcherEvent,
  context?: LambdaContextLike,
): Promise<PhotoMatcherResult> {
  const batchStartedAt = Date.now();
  const batchId = resolveCorrelationId(context?.awsRequestId);
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    // One correlation ID per SQS message: it is what a redelivery and the DLQ
    // entry share, so a failed photo can be followed across its retries.
    const correlationId = resolveCorrelationId(
      record.messageId,
      context?.awsRequestId,
    );
    let current: { eventId: string; photoId: string } | undefined;
    let failedStep: MatchStep | undefined;
    try {
      const photoEvents = parseS3PhotoEvents(record.body);
      for (const { bucket, key, eventId, photoId } of photoEvents) {
        current = { eventId, photoId };
        const photoStartedAt = Date.now();
        await matchPhoto(bucket, eventId, photoId, key, (step) => {
          failedStep = step;
        });
        emitLog('INFO', 'photo_processed', correlationId, {
          eventId,
          photoId,
          durationMs: Date.now() - photoStartedAt,
        });
      }
    } catch (caught) {
      // Without this line a failing message would only surface as a DLQ
      // alarm with nothing to diagnose it. Only the error name and safe step
      // label are logged; request data and error messages stay out of logs.
      emitLog('ERROR', 'photo_matching_failed', correlationId, {
        ...current,
        step: failedStep,
        errorName: errorNameOf(caught),
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  emitLog('INFO', 'photo_batch_processed', batchId, {
    recordCount: event.Records.length,
    failedCount: batchItemFailures.length,
    durationMs: Date.now() - batchStartedAt,
  });

  return { batchItemFailures };
}
