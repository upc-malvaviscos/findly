import {
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  EVENT_LISTING_GSI2_PARTITION_KEY,
  eventKey,
} from '../shared/lib/dynamoKeys';
import {
  emitLog,
  errorNameOf,
  resolveCorrelationId,
  type LambdaContextLike,
} from './lib/logger';
import {
  assertEventCollectionOrigin,
  deleteEventCollection,
  deleteEventObjects,
  deleteEventRecords,
  dynamo,
  eventCleanupDeadline,
  reconcileActiveEvent,
  tableName,
} from './lib/eventCleanup';
import type { EventEntity } from '../shared/types/entities';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export type RetentionPurgerResult = {
  expiredEvents: number;
};

type ExpiredEvent = Pick<
  EventEntity,
  'eventId' | 'createdAt' | 'retentionDays'
> & { cleanupAfter?: number };

function isExpired(event: Partial<EventEntity>, now: number): boolean {
  if (!event.eventId || !event.createdAt || event.retentionDays === undefined)
    return false;
  const expiresAt =
    Date.parse(event.createdAt) + event.retentionDays * MILLISECONDS_PER_DAY;
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

async function findEvents(): Promise<ExpiredEvent[]> {
  const expired: ExpiredEvent[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :events',
        ExpressionAttributeValues: {
          ':events': EVENT_LISTING_GSI2_PARTITION_KEY,
        },
        ProjectionExpression: 'eventId, createdAt, retentionDays, cleanupAfter',
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const item of (page.Items ?? []) as Partial<EventEntity>[])
      if (item.eventId && item.createdAt && item.retentionDays !== undefined)
        expired.push(item as ExpiredEvent);
    exclusiveStartKey = page.LastEvaluatedKey as
      Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return expired;
}

export async function retentionPurger(
  _event?: unknown,
  context?: LambdaContextLike,
): Promise<RetentionPurgerResult> {
  const startedAt = Date.now();
  const correlationId = resolveCorrelationId(context?.awsRequestId);
  let purged = 0;

  try {
    const events = await findEvents();

    for (const event of events) {
      if (!isExpired(event, Date.now())) {
        await reconcileActiveEvent(event.eventId);
        continue;
      }
      const retentionExpiresAtSeconds = Math.floor(
        (Date.parse(event.createdAt) +
          event.retentionDays * MILLISECONDS_PER_DAY) /
          1000,
      );
      const eventDeadline = eventCleanupDeadline(
        retentionExpiresAtSeconds,
        event.cleanupAfter,
      );
      try {
        await dynamo.send(
          new UpdateCommand({
            TableName: tableName,
            Key: eventKey(event.eventId),
            UpdateExpression: 'SET cleanupAfter = :after',
            ExpressionAttributeValues: { ':after': eventDeadline },
            ConditionExpression:
              'attribute_exists(PK) AND (attribute_not_exists(cleanupAfter) OR cleanupAfter <= :after)',
          }),
        );
      } catch (markerError) {
        if (
          (markerError as { name?: string }).name ===
          'ConditionalCheckFailedException'
        )
          continue;
        throw markerError;
      }
      await assertEventCollectionOrigin(event.eventId);
      await deleteEventObjects(event.eventId);
      const complete = await deleteEventRecords(event.eventId);
      if (!complete || eventDeadline > Math.floor(Date.now() / 1000)) continue;
      await deleteEventCollection(event.eventId);
      await dynamo.send(
        new DeleteCommand({
          TableName: tableName,
          Key: eventKey(event.eventId),
        }),
      );
      purged += 1;
      emitLog('INFO', 'event_retention_purged', correlationId, {
        eventId: event.eventId,
      });
    }

    emitLog('INFO', 'retention_purge_completed', correlationId, {
      expiredEvents: purged,
      durationMs: Date.now() - startedAt,
    });
    return { expiredEvents: purged };
  } catch (caught) {
    // A failure aborts the whole run, leaving later expired events un-purged
    // until the next schedule, so it must be visible.
    emitLog('ERROR', 'retention_purge_failed', correlationId, {
      purgedEvents: purged,
      errorName: errorNameOf(caught),
      durationMs: Date.now() - startedAt,
    });
    throw caught;
  }
}
