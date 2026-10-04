import {
  DeleteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  galleryTokenKey,
  registrationPartitionKey,
} from '../../shared/lib/dynamoKeys';

// Inverse references have no TTL: they outlive asynchronous TOKEN TTL deletion
// and remain discoverable until all capabilities have been explicitly revoked.
export async function eraseEmailState(
  db: DynamoDBDocumentClient,
  tableName: string,
  registrationId: string,
) {
  for (const prefix of ['TOKEN#', 'EMAIL#']) {
    let cursor: Record<string, unknown> | undefined;
    do {
      const page = await db.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': registrationPartitionKey(registrationId),
            ':prefix': prefix,
          },
          ConsistentRead: true,
          ExclusiveStartKey: cursor,
        }),
      );
      for (const item of page.Items ?? []) {
        if (prefix === 'TOKEN#' && typeof item.tokenHash === 'string')
          await db.send(
            new DeleteCommand({
              TableName: tableName,
              Key: galleryTokenKey(item.tokenHash),
            }),
          );
        await db.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { PK: item.PK, SK: item.SK },
          }),
        );
      }
      cursor = page.LastEvaluatedKey;
    } while (cursor);
  }
}
