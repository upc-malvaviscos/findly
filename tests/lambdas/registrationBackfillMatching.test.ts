import {
  DeleteFacesCommand,
  IndexFacesCommand,
  RekognitionClient,
  SearchFacesCommand,
} from '@aws-sdk/client-rekognition';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, expect, it } from 'vitest';
import { registrationBackfill } from '../../src/lambdas/registrationBackfill';

const dynamoMock = mockClient(DynamoDBDocumentClient);
const rekognitionMock = mockClient(RekognitionClient);

afterEach(() => {
  dynamoMock.reset();
  rekognitionMock.reset();
});

it('writes the gallery match and photo deletion index atomically through the real backfill matching path', async () => {
  const registrationId = '11111111-1111-4111-8111-111111111111';
  const ttl = 4102444800;
  dynamoMock.on(GetCommand).resolves({
    Item: { status: 'ENROLLED', faceId: 'enrolled-face', ttl },
  });
  dynamoMock
    .on(QueryCommand)
    .resolvesOnce({
      Items: [
        { SK: 'PHOTO#photo-1', s3Key: 'events/demo/photos/photo-1.jpg', ttl },
      ],
    })
    .resolves({
      Items: [
        {
          GSI1SK: `REG#${registrationId}`,
          eventId: 'demo',
          status: 'ENROLLED',
          ttl,
        },
      ],
    });
  rekognitionMock.on(IndexFacesCommand).resolves({
    FaceRecords: [{ Face: { FaceId: 'detected-face' } }],
  });
  rekognitionMock.on(SearchFacesCommand).resolves({
    FaceMatches: [{ Face: { FaceId: 'enrolled-face' }, Similarity: 99 }],
  });
  rekognitionMock.on(DeleteFacesCommand).resolves({});
  dynamoMock.on(TransactWriteCommand).resolves({});

  const result = await registrationBackfill({
    Records: [
      {
        messageId: 'backfill-message',
        body: JSON.stringify({ eventId: 'demo', registrationId }),
      },
    ],
  });

  expect(result.batchItemFailures).toEqual([]);
  const writes = dynamoMock.commandCalls(TransactWriteCommand);
  expect(writes).toHaveLength(1);
  const transaction = writes[0]?.args[0].input.TransactItems;
  expect(transaction).toHaveLength(4);
  expect(transaction?.[0]?.ConditionCheck?.Key).toEqual({
    PK: 'EVENT#demo',
    SK: `REG#${registrationId}`,
  });
  const galleryMatch = transaction?.[1]?.Put?.Item;
  const photoMatch = transaction?.[2]?.Put?.Item;
  expect(galleryMatch).toMatchObject({
    PK: `REG#${registrationId}`,
    SK: 'MATCH#photo-1',
    eventId: 'demo',
    registrationId,
    photoId: 'photo-1',
    ttl,
  });
  expect(photoMatch).toEqual({
    ...galleryMatch,
    PK: 'PHOTO#demo#photo-1',
    SK: `MATCH#${registrationId}`,
  });
  expect(transaction?.[2]?.Put?.ConditionExpression).toBe(
    'attribute_not_exists(PK)',
  );
  // #89: guards against this backfill match surviving the photo's own
  // deletion or TTL expiry.
  expect(transaction?.[3]?.ConditionCheck).toMatchObject({
    Key: { PK: 'EVENT#demo', SK: 'PHOTO#photo-1' },
    ConditionExpression:
      'attribute_exists(PK) AND attribute_not_exists(deletedAt) AND #ttl > :now',
  });
});
