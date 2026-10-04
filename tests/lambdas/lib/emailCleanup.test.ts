import { beforeEach, expect, it } from 'vitest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { eraseEmailState } from '../../../src/lambdas/lib/emailCleanup';
const db = mockClient(DynamoDBDocumentClient);
beforeEach(() => {
  db.reset();
  db.on(DeleteCommand).resolves({});
});
it('revokes every token before its inverse reference, paginates and deletes recipient work', async () => {
  db.on(QueryCommand).callsFake((input) => {
    if (input.ExpressionAttributeValues[':prefix'] === 'EMAIL#')
      return { Items: [{ PK: 'REG#synthetic', SK: 'EMAIL#operation' }] };
    return input.ExclusiveStartKey
      ? { Items: [{ PK: 'REG#synthetic', SK: 'TOKEN#two', tokenHash: 'two' }] }
      : {
          Items: [{ PK: 'REG#synthetic', SK: 'TOKEN#one', tokenHash: 'one' }],
          LastEvaluatedKey: { PK: 'REG#synthetic', SK: 'TOKEN#one' },
        };
  });
  await eraseEmailState(
    DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'eu-west-1' })),
    'synthetic',
    'synthetic',
  );
  expect(
    db.commandCalls(DeleteCommand).map((call) => call.args[0].input.Key),
  ).toEqual([
    { PK: 'TOKEN#one', SK: 'METADATA' },
    { PK: 'REG#synthetic', SK: 'TOKEN#one' },
    { PK: 'TOKEN#two', SK: 'METADATA' },
    { PK: 'REG#synthetic', SK: 'TOKEN#two' },
    { PK: 'REG#synthetic', SK: 'EMAIL#operation' },
  ]);
});
it('handles empty partitions and propagates failed token deletion for retry', async () => {
  db.on(QueryCommand).resolves({ Items: [] });
  await eraseEmailState(
    DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'eu-west-1' })),
    'synthetic',
    'synthetic',
  );
  expect(db.commandCalls(DeleteCommand)).toHaveLength(0);
  db.on(QueryCommand).resolves({
    Items: [{ PK: 'REG#synthetic', SK: 'TOKEN#one', tokenHash: 'one' }],
  });
  db.on(DeleteCommand).rejects(new Error('synthetic'));
  await expect(
    eraseEmailState(
      DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'eu-west-1' })),
      'synthetic',
      'synthetic',
    ),
  ).rejects.toThrow('synthetic');
});
