import {
  DeleteFacesCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteRegistration } from '../../src/lambdas/deleteRegistration';
import { captureLogs } from './lib/logCapture';

const dynamoMock = mockClient(DynamoDBDocumentClient);
const rekognitionMock = mockClient(RekognitionClient);
const s3Mock = mockClient(S3Client);

afterEach(() => {
  dynamoMock.reset();
  rekognitionMock.reset();
  s3Mock.reset();
});

function request(registrationId: string, token: string) {
  return {
    pathParameters: { registrationId },
    headers: { 'x-gallery-token': token },
  };
}

describe('deleteRegistration lambda', () => {
  it('rejects requests missing the registrationId or the token header', async () => {
    const missingId = await deleteRegistration({
      pathParameters: {},
      headers: { 'x-gallery-token': 'secret' },
    });
    expect(missingId.statusCode).toBe(400);

    const missingToken = await deleteRegistration({
      pathParameters: { registrationId: 'reg-1' },
      headers: {},
    });
    expect(missingToken.statusCode).toBe(400);
  });

  it('returns not found without revealing the token when the token is unknown', async () => {
    dynamoMock.on(GetCommand).resolves({});
    const result = await deleteRegistration(request('reg-1', 'secret-token'));
    expect(result.statusCode).toBe(404);
    expect(result.body).not.toContain('secret-token');
  });

  it('returns not found when the token belongs to a different registration', async () => {
    dynamoMock
      .on(GetCommand)
      .resolves({ Item: { registrationId: 'reg-other', eventId: 'evt-1' } });
    const result = await deleteRegistration(request('reg-1', 'token'));
    expect(result.statusCode).toBe(404);
  });

  it('deletes the face, the selfie, matches, registration and token on success', async () => {
    dynamoMock
      .on(GetCommand)
      .resolvesOnce({
        Item: { registrationId: 'reg-1', eventId: 'evt-1' },
      })
      .resolvesOnce({ Item: { faceId: 'face-1' } });
    dynamoMock.on(QueryCommand).resolves({
      Items: [{ photoId: 'photo-1' }, { photoId: 'photo-2' }],
    });
    dynamoMock.on(DeleteCommand).resolves({});
    rekognitionMock.on(DeleteFacesCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});

    const result = await deleteRegistration(request('reg-1', 'token'));

    expect(result.statusCode).toBe(204);
    expect(result.body).toBe('');

    const faceDeleteCalls = rekognitionMock.commandCalls(DeleteFacesCommand);
    expect(faceDeleteCalls).toHaveLength(1);
    expect(faceDeleteCalls[0]?.args[0].input.FaceIds).toEqual(['face-1']);

    const selfieDeleteCalls = s3Mock.commandCalls(DeleteObjectCommand);
    expect(selfieDeleteCalls).toHaveLength(1);
    expect(selfieDeleteCalls[0]?.args[0].input.Key).toBe(
      'events/evt-1/selfies/reg-1.jpg',
    );

    const dynamoDeleteCalls = dynamoMock.commandCalls(DeleteCommand);
    expect(dynamoDeleteCalls).toHaveLength(4); // 2 matches + registration + token
    const deletedKeys = dynamoDeleteCalls.map((call) => call.args[0].input.Key);
    expect(deletedKeys).toContainEqual({
      PK: 'REG#reg-1',
      SK: 'MATCH#photo-1',
    });
    expect(deletedKeys).toContainEqual({
      PK: 'REG#reg-1',
      SK: 'MATCH#photo-2',
    });
    expect(deletedKeys).toContainEqual({ PK: 'EVENT#evt-1', SK: 'REG#reg-1' });
  });

  it('deletes every matches page before revoking a mixed-case token header', async () => {
    dynamoMock
      .on(GetCommand)
      .resolvesOnce({ Item: { registrationId: 'reg-1', eventId: 'evt-1' } })
      .resolvesOnce({ Item: {} });
    const cursor = { PK: 'REG#reg-1', SK: 'MATCH#photo-1' };
    dynamoMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [{ photoId: 'photo-1' }],
        LastEvaluatedKey: cursor,
      })
      .resolvesOnce({ Items: [{ photoId: 'photo-2' }] });
    dynamoMock.on(DeleteCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    const result = await deleteRegistration({
      pathParameters: { registrationId: 'reg-1' },
      headers: { 'X-Gallery-Token': 'token' },
    });
    expect(result.statusCode).toBe(204);
    expect(
      dynamoMock.commandCalls(QueryCommand)[1]?.args[0].input.ExclusiveStartKey,
    ).toEqual(cursor);
    expect(
      dynamoMock
        .commandCalls(DeleteCommand)
        .map((call) => call.args[0].input.Key),
    ).toContainEqual({ PK: 'REG#reg-1', SK: 'MATCH#photo-2' });
  });

  it('keeps the registration and token available for retry if a match delete fails', async () => {
    dynamoMock
      .on(GetCommand)
      .resolvesOnce({ Item: { registrationId: 'reg-1', eventId: 'evt-1' } })
      .resolvesOnce({ Item: {} });
    dynamoMock.on(QueryCommand).resolves({ Items: [{ photoId: 'photo-1' }] });
    dynamoMock.on(DeleteCommand).rejects(new Error('temporary outage'));
    s3Mock.on(DeleteObjectCommand).resolves({});
    await expect(deleteRegistration(request('reg-1', 'token'))).rejects.toThrow(
      'temporary outage',
    );
    expect(dynamoMock.commandCalls(DeleteCommand)).toHaveLength(1);
  });

  it('skips the Rekognition call when the registration has no faceId', async () => {
    dynamoMock
      .on(GetCommand)
      .resolvesOnce({ Item: { registrationId: 'reg-1', eventId: 'evt-1' } })
      .resolvesOnce({ Item: {} });
    dynamoMock.on(QueryCommand).resolves({ Items: [] });
    dynamoMock.on(DeleteCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});

    const result = await deleteRegistration(request('reg-1', 'token'));

    expect(result.statusCode).toBe(204);
    expect(rekognitionMock.commandCalls(DeleteFacesCommand)).toHaveLength(0);
  });

  it('treats an already-deleted face or selfie as success, not an error', async () => {
    dynamoMock
      .on(GetCommand)
      .resolvesOnce({ Item: { registrationId: 'reg-1', eventId: 'evt-1' } })
      .resolvesOnce({ Item: { faceId: 'face-1' } });
    dynamoMock.on(QueryCommand).resolves({ Items: [] });
    dynamoMock.on(DeleteCommand).resolves({});
    const missing = new Error('not found');
    missing.name = 'ResourceNotFoundException';
    rekognitionMock.on(DeleteFacesCommand).rejects(missing);
    const noSuchKey = new Error('no such key');
    noSuchKey.name = 'NoSuchKey';
    s3Mock.on(DeleteObjectCommand).rejects(noSuchKey);

    const result = await deleteRegistration(request('reg-1', 'token'));

    expect(result.statusCode).toBe(204);
  });

  it('propagates an unexpected Rekognition error instead of silently succeeding', async () => {
    dynamoMock
      .on(GetCommand)
      .resolvesOnce({ Item: { registrationId: 'reg-1', eventId: 'evt-1' } })
      .resolvesOnce({ Item: { faceId: 'face-1' } });
    rekognitionMock
      .on(DeleteFacesCommand)
      .rejects(new Error('service unavailable'));

    await expect(deleteRegistration(request('reg-1', 'token'))).rejects.toThrow(
      'service unavailable',
    );
  });
});

describe('deleteRegistration structured logging', () => {
  let logs: ReturnType<typeof captureLogs>;
  beforeEach(() => {
    logs = captureLogs();
  });
  afterEach(() => logs.restore());

  it('writes an erasure audit line without registrationId or token, correlated to the request', async () => {
    dynamoMock
      .on(GetCommand)
      .resolvesOnce({ Item: { registrationId: 'reg-1', eventId: 'evt-1' } })
      .resolvesOnce({ Item: { faceId: 'face-secret-1' } });
    dynamoMock.on(QueryCommand).resolves({
      Items: [{ photoId: 'photo-1' }, { photoId: 'photo-2' }],
    });
    dynamoMock.on(DeleteCommand).resolves({});
    rekognitionMock.on(DeleteFacesCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});

    const result = await deleteRegistration({
      ...request('reg-1', 'gallery-token-secret'),
      requestContext: { requestId: 'apigw-req-1' },
    });

    expect(result.statusCode).toBe(204);
    expect(logs.records()).toEqual([
      {
        level: 'INFO',
        event: 'registration_erased',
        correlationId: 'apigw-req-1',
        eventId: 'evt-1',
        matchesDeleted: 2,
        faceDeleted: true,
      },
      expect.objectContaining({
        level: 'INFO',
        event: 'delete_registration_request',
        correlationId: 'apigw-req-1',
        eventId: 'evt-1',
        statusCode: 204,
      }),
    ]);
    const output = logs.lines.join('');
    expect(output).not.toContain('reg-1');
    expect(output).not.toContain('gallery-token-secret');
    expect(output).not.toContain('face-secret-1');
  });

  it('returns the correlation ID as requestId so a client report can be traced', async () => {
    dynamoMock.on(GetCommand).resolves({});
    const result = await deleteRegistration(
      {
        ...request('reg-1', 'secret-token'),
        requestContext: { requestId: 'apigw-req-2' },
      },
      { awsRequestId: 'lambda-req-2' },
    );
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).requestId).toBe('apigw-req-2');
    expect(logs.records()[0]).toMatchObject({
      level: 'WARN',
      correlationId: 'apigw-req-2',
      statusCode: 404,
    });
    expect(logs.lines.join('')).not.toContain('secret-token');
  });

  it('logs an ERROR with the error name only when a dependency fails', async () => {
    dynamoMock
      .on(GetCommand)
      .resolvesOnce({ Item: { registrationId: 'reg-1', eventId: 'evt-1' } })
      .resolvesOnce({ Item: { faceId: 'face-1' } });
    const failure = new Error('rekognition arn:aws:secret is unreachable');
    failure.name = 'ServiceUnavailableException';
    rekognitionMock.on(DeleteFacesCommand).rejects(failure);

    await expect(
      deleteRegistration(request('reg-1', 'token'), { awsRequestId: 'l-1' }),
    ).rejects.toBe(failure);

    expect(logs.records()).toEqual([
      expect.objectContaining({
        level: 'ERROR',
        event: 'delete_registration_request_failed',
        correlationId: 'l-1',
        eventId: 'evt-1',
        errorName: 'ServiceUnavailableException',
      }),
    ]);
    expect(logs.lines.join('')).not.toContain('arn:aws:secret');
  });
});
