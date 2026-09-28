import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CreateCollectionCommand,
  DeleteFacesCommand,
  IndexFacesCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { selfieIndexer } from '../../src/lambdas/selfieIndexer';
const db = mockClient(DynamoDBDocumentClient);
const faces = mockClient(RekognitionClient);
const key = 'events/demo/selfies/reg.jpg';
const event = {
  Records: [{ s3: { bucket: { name: 'synthetic' }, object: { key } } }],
};
beforeEach(() => {
  db.reset();
  faces.reset();
  db.on(GetCommand).resolves({
    Item: {
      status: 'UPLOAD_PENDING',
      consentTimestamp: '2026-09-28',
      selfieS3Key: key,
      ttl: Math.floor(Date.now() / 1000) + 600,
    },
  });
  db.on(UpdateCommand).resolves({});
  faces
    .on(IndexFacesCommand)
    .resolves({ FaceRecords: [{ Face: { FaceId: 'synthetic-face' } }] });
});
describe('selfie indexer', () => {
  it('indexes exactly one consented selfie and persists face lookup under the lease', async () => {
    await selfieIndexer(event);
    expect(
      faces.commandCalls(IndexFacesCommand)[0]?.args[0].input,
    ).toMatchObject({
      CollectionId: 'findly-event-demo',
      ExternalImageId: 'reg',
      MaxFaces: 1,
      QualityFilter: 'AUTO',
    });
    expect(
      faces.commandCalls(CreateCollectionCommand)[0]?.args[0].input.Tags,
    ).toMatchObject({
      Project: 'findly',
      Environment: 'local',
      ManagedBy: 'Terraform',
      CostCenter: 'local-validation',
      DataClass: 'synthetic',
    });
    const updates = db.commandCalls(UpdateCommand);
    expect(updates[0]?.args[0].input.ConditionExpression).toContain(
      'processingLeaseUntil < :now',
    );
    expect(updates[1]?.args[0].input.ExpressionAttributeValues).toMatchObject({
      ':status': 'ENROLLED',
      ':gpk': 'FACE#synthetic-face',
      ':gsk': 'REG#reg',
    });
    expect(updates[1]?.args[0].input.ConditionExpression).toContain(
      'processingClaim = :claim',
    );
  });
  it('reuses an existing event collection safely', async () => {
    faces
      .on(CreateCollectionCommand)
      .rejects({ name: 'ResourceAlreadyExistsException' });
    await selfieIndexer(event);
    expect(faces.commandCalls(IndexFacesCommand)).toHaveLength(1);
  });
  it('accepts disjoint notification suffix while retaining legacy parsing', async () => {
    const newKey = 'events/demo/selfies/reg.selfie.jpg';
    db.on(GetCommand).resolves({
      Item: {
        status: 'UPLOAD_PENDING',
        consentTimestamp: 'yes',
        selfieS3Key: newKey,
        ttl: Math.floor(Date.now() / 1000) + 600,
      },
    });
    await selfieIndexer({
      Records: [
        { s3: { bucket: { name: 'synthetic' }, object: { key: newKey } } },
      ],
    });
    expect(
      faces.commandCalls(IndexFacesCommand)[0]?.args[0].input.ExternalImageId,
    ).toBe('reg');
    expect(
      db.commandCalls(UpdateCommand)[0]?.args[0].input.ConditionExpression,
    ).toContain('attribute_not_exists(erasureRequestedAt)');
    expect(
      db.commandCalls(UpdateCommand)[1]?.args[0].input.ConditionExpression,
    ).toContain('attribute_not_exists(erasureRequestedAt)');
  });
  it('marks a no-face image FAILED without retrying', async () => {
    faces.on(CreateCollectionCommand).resolves({});
    faces.on(IndexFacesCommand).resolves({ FaceRecords: [] });
    await selfieIndexer(event);
    expect(
      db.commandCalls(UpdateCommand)[1]?.args[0].input
        .ExpressionAttributeValues?.[':status'],
    ).toBe('FAILED');
  });
  it('marks malformed images terminal instead of retrying indefinitely', async () => {
    faces
      .on(IndexFacesCommand)
      .rejects({ name: 'InvalidImageFormatException' });
    await selfieIndexer(event);
    expect(
      db.commandCalls(UpdateCommand)[1]?.args[0].input
        .ExpressionAttributeValues?.[':failed'],
    ).toBe('FAILED');
  });
  it('ignores terminal, removed, unconsented and expired registrations', async () => {
    for (const item of [
      undefined,
      { status: 'ENROLLED' },
      { status: 'FAILED' },
      { status: 'UPLOAD_PENDING' },
      {
        status: 'UPLOAD_PENDING',
        consentTimestamp: 'yes',
        selfieS3Key: key,
        ttl: 0,
      },
    ]) {
      db.on(GetCommand).resolves({ Item: item });
      await selfieIndexer(event);
    }
    expect(faces.calls()).toHaveLength(0);
  });
  it('ignores photographs routed through the shared S3 notification', async () => {
    await selfieIndexer({
      Records: [
        {
          s3: {
            bucket: { name: 'synthetic' },
            object: { key: 'events/demo/photos/photo.jpg' },
          },
        },
        {},
      ],
    });
    expect(db.calls()).toHaveLength(0);
  });
  it('ignores duplicate contention without indexing twice', async () => {
    db.on(UpdateCommand).rejects({ name: 'ConditionalCheckFailedException' });
    await selfieIndexer(event);
    expect(faces.calls()).toHaveLength(0);
  });
  it('recovers PROCESSING after an expired lease using the same external image identity', async () => {
    db.on(GetCommand).resolves({
      Item: {
        status: 'PROCESSING',
        consentTimestamp: 'yes',
        selfieS3Key: key,
        ttl: Math.floor(Date.now() / 1000) + 600,
        processingLeaseUntil: 1,
      },
    });
    await selfieIndexer(event);
    expect(faces.commandCalls(IndexFacesCommand)).toHaveLength(1);
  });
  it('propagates transient failures so S3 can recover after lease expiry', async () => {
    faces.on(IndexFacesCommand).rejects({ name: 'ThrottlingException' });
    await expect(selfieIndexer(event)).rejects.toMatchObject({
      name: 'ThrottlingException',
    });
    expect(db.commandCalls(UpdateCommand)).toHaveLength(1);
  });
  it('cleans up an indexed face when concurrent erasure invalidates persistence', async () => {
    db.on(GetCommand)
      .resolvesOnce({
        Item: {
          status: 'UPLOAD_PENDING',
          consentTimestamp: 'yes',
          selfieS3Key: key,
          ttl: Math.floor(Date.now() / 1000) + 600,
        },
      })
      .resolves({});
    db.on(UpdateCommand)
      .resolvesOnce({})
      .rejects({ name: 'ConditionalCheckFailedException' });
    faces.on(DeleteFacesCommand).resolves({});
    await selfieIndexer(event);
    expect(
      faces.commandCalls(DeleteFacesCommand)[0]?.args[0].input.FaceIds,
    ).toEqual(['synthetic-face']);
  });
  it('preserves the deduplicated face committed by the winning worker', async () => {
    db.on(GetCommand)
      .resolvesOnce({
        Item: {
          status: 'UPLOAD_PENDING',
          consentTimestamp: 'yes',
          selfieS3Key: key,
          ttl: Math.floor(Date.now() / 1000) + 600,
        },
      })
      .resolves({ Item: { status: 'ENROLLED', faceId: 'synthetic-face' } });
    db.on(UpdateCommand)
      .resolvesOnce({})
      .rejects({ name: 'ConditionalCheckFailedException' });
    await selfieIndexer(event);
    expect(faces.commandCalls(DeleteFacesCommand)).toHaveLength(0);
    expect(db.commandCalls(GetCommand)[1]?.args[0].input.ConsistentRead).toBe(
      true,
    );
  });
  it('fails closed when Rekognition reports an individual cleanup failure with HTTP 200', async () => {
    db.on(GetCommand)
      .resolvesOnce({
        Item: {
          status: 'UPLOAD_PENDING',
          consentTimestamp: 'yes',
          selfieS3Key: key,
          ttl: Math.floor(Date.now() / 1000) + 600,
        },
      })
      .resolves({});
    db.on(UpdateCommand)
      .resolvesOnce({})
      .rejects({ name: 'ConditionalCheckFailedException' });
    faces.on(DeleteFacesCommand).resolves({
      UnsuccessfulFaceDeletions: [
        {
          FaceId: 'synthetic-face',
          Reasons: ['ASSOCIATED_TO_AN_EXISTING_USER'],
        },
      ],
    });
    await expect(selfieIndexer(event)).rejects.toThrow(
      'FACE_CLEANUP_INCOMPLETE',
    );
  });
});
