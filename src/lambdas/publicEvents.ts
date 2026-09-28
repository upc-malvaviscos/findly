import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  eventKey,
  EVENT_LISTING_GSI2_PARTITION_KEY,
} from '../shared/lib/dynamoKeys';
import { withRequestLog, type LambdaContextLike } from './lib/logger';
import type { EventEntity } from '../shared/types/entities';

type HttpEvent = {
  pathParameters?: Record<string, string | undefined> | null;
  requestContext?: { requestId?: string } | null;
};
const tableName = process.env.FINDLY_TABLE_NAME ?? 'findly-local';
const endpoint = process.env.AWS_ENDPOINT_URL;
const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'eu-west-1',
    ...(endpoint ? { endpoint } : {}),
  }),
);
const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const publicEvent = ({ eventId, name, date }: EventEntity) => ({
  eventId,
  name,
  date,
});

export async function listPublicEvents(
  event: HttpEvent = {},
  context?: LambdaContextLike,
) {
  return withRequestLog(
    'public_list_events',
    {
      requestId: event.requestContext?.requestId,
      awsRequestId: context?.awsRequestId,
    },
    async () => {
      const events: ReturnType<typeof publicEvent>[] = [];
      let cursor: Record<string, unknown> | undefined;
      do {
        const result = await dynamo.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: 'GSI2',
            KeyConditionExpression: 'GSI2PK = :pk',
            FilterExpression: '#status = :open',
            ExpressionAttributeNames: {
              '#status': 'status',
              '#name': 'name',
              '#date': 'date',
            },
            ExpressionAttributeValues: {
              ':pk': EVENT_LISTING_GSI2_PARTITION_KEY,
              ':open': 'OPEN',
            },
            ProjectionExpression: 'eventId, #name, #date',
            ExclusiveStartKey: cursor,
          }),
        );
        events.push(
          ...(result.Items ?? []).map((item) =>
            publicEvent(item as EventEntity),
          ),
        );
        cursor = result.LastEvaluatedKey;
      } while (cursor);
      return json(200, { events });
    },
  );
}

export async function getPublicEvent(
  event: HttpEvent,
  context?: LambdaContextLike,
) {
  return withRequestLog(
    'public_get_event',
    {
      requestId: event.requestContext?.requestId,
      awsRequestId: context?.awsRequestId,
    },
    async (request) => {
      const eventId = event.pathParameters?.eventId;
      if (!eventId)
        return json(400, {
          code: 'INVALID_REQUEST',
          message: 'Event ID is required.',
          requestId: request.correlationId,
        });
      const item = (
        await dynamo.send(
          new GetCommand({
            TableName: tableName,
            Key: eventKey(eventId),
            ConsistentRead: true,
          }),
        )
      ).Item as EventEntity | undefined;
      if (!item || item.status !== 'OPEN')
        return json(404, {
          code: 'EVENT_NOT_FOUND',
          message: 'Event not found.',
          requestId: request.correlationId,
        });
      request.annotate({ eventId });
      return json(200, publicEvent(item));
    },
  );
}
