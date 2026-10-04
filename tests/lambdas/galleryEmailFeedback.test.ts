import { beforeEach, expect, it } from 'vitest';
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { galleryEmailFeedback } from '../../src/lambdas/galleryEmailFeedback';
const db = mockClient(DynamoDBDocumentClient);
const payload = (eventType = 'Bounce', bounceType = 'Permanent') => ({
  Records: [
    {
      body: JSON.stringify({
        eventType,
        bounce: { bounceType },
        mail: {
          tags: {
            eventId: ['synthetic-event'],
            registrationId: ['synthetic-reg'],
            operationId: ['00000000-0000-4000-8000-000000000001'],
          },
        },
      }),
    },
  ],
});
beforeEach(() => {
  db.reset();
  db.on(TransactWriteCommand).resolves({});
});
it('records permanent bounces and complaints exactly once with conditional updates', async () => {
  await galleryEmailFeedback(payload());
  await galleryEmailFeedback(payload('Complaint'));
  const transactions = db
    .commandCalls(TransactWriteCommand)
    .map((call) => call.args[0].input.TransactItems!);
  expect(transactions[0]?.[0]?.Update?.ConditionExpression).toContain(
    'attribute_not_exists(#field)',
  );
  expect(transactions[0]?.[1]?.Update?.ExpressionAttributeNames).toEqual({
    '#field': 'bounced',
  });
  expect(transactions[1]?.[1]?.Update?.ExpressionAttributeNames).toEqual({
    '#field': 'complained',
  });
  expect(JSON.stringify(transactions)).not.toContain('@');
});
it('ignores temporary bounces and unsupported events', async () => {
  await galleryEmailFeedback(payload('Bounce', 'Transient'));
  await galleryEmailFeedback(payload('Delivery'));
  expect(db.calls()).toHaveLength(0);
});
it('ignores duplicates and erased records but retries transaction/storage failures', async () => {
  db.on(TransactWriteCommand).rejects(
    Object.assign(new Error('synthetic'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    }),
  );
  await galleryEmailFeedback(payload());
  db.on(TransactWriteCommand).rejects(
    Object.assign(new Error('synthetic'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'TransactionConflict' }],
    }),
  );
  await expect(galleryEmailFeedback(payload())).rejects.toBeDefined();
  db.on(TransactWriteCommand).rejects(new Error('synthetic'));
  await expect(galleryEmailFeedback(payload())).rejects.toBeDefined();
});
