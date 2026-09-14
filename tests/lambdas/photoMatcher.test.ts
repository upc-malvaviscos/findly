import {
  DeleteFacesCommand,
  IndexFacesCommand,
  RekognitionClient,
  SearchFacesCommand,
} from '@aws-sdk/client-rekognition';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, describe, expect, it } from 'vitest';
import { photoMatcher } from '../../src/lambdas/photoMatcher';

const rekognitionMock = mockClient(RekognitionClient);
const dynamoMock = mockClient(DynamoDBDocumentClient);

afterEach(() => {
  rekognitionMock.reset();
  dynamoMock.reset();
});

function sqsRecord(messageId: string, photoId: string, bucket = 'findly-photos') {
  return {
    messageId,
    body: JSON.stringify({
      Records: [
        {
          eventName: 'ObjectCreated:Put',
          s3: {
            bucket: { name: bucket },
            object: { key: `events/demo-2026/photos/${photoId}.jpg` },
          },
        },
      ],
    }),
  };
}

describe('photoMatcher', () => {
  it('skips SQS records whose S3 key is not an event photo key', async () => {
    const record = {
      messageId: 'msg-1',
      body: JSON.stringify({
        Records: [
          {
            s3: {
              bucket: { name: 'findly-photos' },
              object: { key: 'events/demo-2026/selfies/reg-1.jpg' },
            },
          },
        ],
      }),
    };
    const result = await photoMatcher({ Records: [record] });
    expect(result.batchItemFailures).toEqual([]);
    expect(rekognitionMock.calls()).toHaveLength(0);
  });

  it('skips a record with an unparseable body without failing the batch', async () => {
    const result = await photoMatcher({
      Records: [{ messageId: 'msg-1', body: 'not json' }],
    });
    expect(result.batchItemFailures).toEqual([]);
  });

  it('indexes and deletes the photo faces even when no faces are detected', async () => {
    rekognitionMock.on(IndexFacesCommand).resolves({ FaceRecords: [] });
    const result = await photoMatcher({ Records: [sqsRecord('msg-1', 'photo-1')] });

    expect(result.batchItemFailures).toEqual([]);
    expect(rekognitionMock.commandCalls(SearchFacesCommand)).toHaveLength(0);
    expect(rekognitionMock.commandCalls(DeleteFacesCommand)).toHaveLength(0);
    expect(dynamoMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('writes a Match for a face above the threshold found via GSI1', async () => {
    rekognitionMock.on(IndexFacesCommand).resolves({
      FaceRecords: [{ Face: { FaceId: 'detected-face-1' } }],
    });
    rekognitionMock.on(SearchFacesCommand).resolves({
      FaceMatches: [
        { Face: { FaceId: 'enrolled-face-1' }, Similarity: 98.2 },
      ],
    });
    dynamoMock.on(QueryCommand).resolves({
      Items: [{ GSI1PK: 'FACE#enrolled-face-1', GSI1SK: 'REG#reg-1' }],
    });
    dynamoMock.on(PutCommand).resolves({});

    const result = await photoMatcher({ Records: [sqsRecord('msg-1', 'photo-1')] });

    expect(result.batchItemFailures).toEqual([]);
    const putCalls = dynamoMock.commandCalls(PutCommand);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]?.args[0].input.Item).toMatchObject({
      PK: 'REG#reg-1',
      SK: 'MATCH#photo-1',
      eventId: 'demo-2026',
      registrationId: 'reg-1',
      photoId: 'photo-1',
      similarity: 98.2,
    });

    const deleteCalls = rekognitionMock.commandCalls(DeleteFacesCommand);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]?.args[0].input.FaceIds).toEqual(['detected-face-1']);
  });

  it('skips a match below the 95% threshold', async () => {
    rekognitionMock.on(IndexFacesCommand).resolves({
      FaceRecords: [{ Face: { FaceId: 'detected-face-1' } }],
    });
    rekognitionMock.on(SearchFacesCommand).resolves({
      FaceMatches: [{ Face: { FaceId: 'enrolled-face-1' }, Similarity: 90 }],
    });

    const result = await photoMatcher({ Records: [sqsRecord('msg-1', 'photo-1')] });

    expect(result.batchItemFailures).toEqual([]);
    expect(dynamoMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('ignores a matched face that has no registration in GSI1 (e.g. another photo)', async () => {
    rekognitionMock.on(IndexFacesCommand).resolves({
      FaceRecords: [{ Face: { FaceId: 'detected-face-1' } }],
    });
    rekognitionMock.on(SearchFacesCommand).resolves({
      FaceMatches: [{ Face: { FaceId: 'other-photo-face' }, Similarity: 99 }],
    });
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    const result = await photoMatcher({ Records: [sqsRecord('msg-1', 'photo-1')] });

    expect(result.batchItemFailures).toEqual([]);
    expect(dynamoMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('ignores a self-match of the freshly indexed face against itself', async () => {
    rekognitionMock.on(IndexFacesCommand).resolves({
      FaceRecords: [{ Face: { FaceId: 'detected-face-1' } }],
    });
    rekognitionMock.on(SearchFacesCommand).resolves({
      FaceMatches: [{ Face: { FaceId: 'detected-face-1' }, Similarity: 100 }],
    });

    const result = await photoMatcher({ Records: [sqsRecord('msg-1', 'photo-1')] });

    expect(result.batchItemFailures).toEqual([]);
    expect(dynamoMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('writes a Match for every detected face in a group photo', async () => {
    rekognitionMock.on(IndexFacesCommand).resolves({
      FaceRecords: [
        { Face: { FaceId: 'detected-face-1' } },
        { Face: { FaceId: 'detected-face-2' } },
      ],
    });
    rekognitionMock
      .on(SearchFacesCommand, { FaceId: 'detected-face-1' })
      .resolves({
        FaceMatches: [{ Face: { FaceId: 'enrolled-face-1' }, Similarity: 96 }],
      });
    rekognitionMock
      .on(SearchFacesCommand, { FaceId: 'detected-face-2' })
      .resolves({
        FaceMatches: [{ Face: { FaceId: 'enrolled-face-2' }, Similarity: 97 }],
      });
    dynamoMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': 'FACE#enrolled-face-1' },
      })
      .resolves({ Items: [{ GSI1SK: 'REG#reg-1' }] });
    dynamoMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': 'FACE#enrolled-face-2' },
      })
      .resolves({ Items: [{ GSI1SK: 'REG#reg-2' }] });
    dynamoMock.on(PutCommand).resolves({});

    const result = await photoMatcher({ Records: [sqsRecord('msg-1', 'photo-1')] });

    expect(result.batchItemFailures).toEqual([]);
    expect(dynamoMock.commandCalls(PutCommand)).toHaveLength(2);
    const deleteCalls = rekognitionMock.commandCalls(DeleteFacesCommand);
    expect(deleteCalls[0]?.args[0].input.FaceIds).toEqual([
      'detected-face-1',
      'detected-face-2',
    ]);
  });

  it('swallows a duplicate Match write from SQS redelivery without failing', async () => {
    rekognitionMock.on(IndexFacesCommand).resolves({
      FaceRecords: [{ Face: { FaceId: 'detected-face-1' } }],
    });
    rekognitionMock.on(SearchFacesCommand).resolves({
      FaceMatches: [{ Face: { FaceId: 'enrolled-face-1' }, Similarity: 98 }],
    });
    dynamoMock
      .on(QueryCommand)
      .resolves({ Items: [{ GSI1SK: 'REG#reg-1' }] });
    const conditionalError = new Error('conditional check failed');
    conditionalError.name = 'ConditionalCheckFailedException';
    dynamoMock.on(PutCommand).rejects(conditionalError);

    const result = await photoMatcher({ Records: [sqsRecord('msg-1', 'photo-1')] });

    expect(result.batchItemFailures).toEqual([]);
  });

  it('always deletes the temporary photo faces, even if matching throws', async () => {
    rekognitionMock.on(IndexFacesCommand).resolves({
      FaceRecords: [{ Face: { FaceId: 'detected-face-1' } }],
    });
    rekognitionMock
      .on(SearchFacesCommand)
      .rejects(new Error('rekognition unavailable'));

    const result = await photoMatcher({ Records: [sqsRecord('msg-1', 'photo-1')] });

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }]);
    const deleteCalls = rekognitionMock.commandCalls(DeleteFacesCommand);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]?.args[0].input.FaceIds).toEqual(['detected-face-1']);
  });

  it('only reports the failing message in a batch, leaving the others processed', async () => {
    rekognitionMock
      .on(IndexFacesCommand, {
        Image: {
          S3Object: {
            Bucket: 'findly-photos',
            Name: 'events/demo-2026/photos/photo-fail.jpg',
          },
        },
      })
      .rejects(new Error('rekognition unavailable'));
    rekognitionMock
      .on(IndexFacesCommand, {
        Image: {
          S3Object: {
            Bucket: 'findly-photos',
            Name: 'events/demo-2026/photos/photo-ok.jpg',
          },
        },
      })
      .resolves({ FaceRecords: [] });

    const result = await photoMatcher({
      Records: [
        sqsRecord('msg-fail', 'photo-fail'),
        sqsRecord('msg-ok', 'photo-ok'),
      ],
    });

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-fail' }]);
  });
});
