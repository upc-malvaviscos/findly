import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getPublicEvent,
  listPublicEvents,
} from '../../src/lambdas/publicEvents';
const db = mockClient(DynamoDBDocumentClient);
beforeEach(() => db.reset());
describe('public events', () => {
  it('paginates filtered event listing without exposing internal fields', async () => {
    db.on(QueryCommand)
      .resolvesOnce({ Items: [], LastEvaluatedKey: { PK: 'last' } })
      .resolvesOnce({
        Items: [
          {
            eventId: 'e',
            name: 'Demo',
            date: '2026-10-01',
            createdAt: 'private',
          },
        ],
      });
    const result = await listPublicEvents();
    expect(JSON.parse(result.body)).toEqual({
      events: [{ eventId: 'e', name: 'Demo', date: '2026-10-01' }],
    });
    expect(
      db.commandCalls(QueryCommand)[1]?.args[0].input.ExclusiveStartKey,
    ).toEqual({ PK: 'last' });
    expect(
      db.commandCalls(QueryCommand)[0]?.args[0].input.FilterExpression,
    ).toBe('#status = :open');
  });
  it('returns only public details for an open event', async () => {
    db.on(GetCommand).resolves({
      Item: {
        eventId: 'e',
        name: 'Demo',
        date: '2026-10-01',
        status: 'OPEN',
        retentionDays: 30,
      },
    });
    expect(
      JSON.parse(
        (await getPublicEvent({ pathParameters: { eventId: 'e' } })).body,
      ),
    ).toEqual({ eventId: 'e', name: 'Demo', date: '2026-10-01' });
  });
  it('does not disclose closed or missing events', async () => {
    db.on(GetCommand)
      .resolvesOnce({ Item: { status: 'CLOSED' } })
      .resolves({});
    expect(
      (await getPublicEvent({ pathParameters: { eventId: 'e' } })).statusCode,
    ).toBe(404);
    expect(
      (await getPublicEvent({ pathParameters: { eventId: 'absent' } }))
        .statusCode,
    ).toBe(404);
    expect((await getPublicEvent({})).statusCode).toBe(400);
  });
});
