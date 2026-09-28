import {
  CreateCollectionCommand,
  DeleteFacesCommand,
  IndexFacesCommand,
  ListFacesCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selfieIndexer } from '../../src/lambdas/selfieIndexer';
const db = mockClient(DynamoDBDocumentClient);
const faces = mockClient(RekognitionClient);
const objects = mockClient(S3Client);
const key = 'events/demo/selfies/reg.selfie.jpg';
const event = {
  Records: [{ s3: { bucket: { name: 'synthetic' }, object: { key } } }],
};
let registration: Record<string, unknown> | undefined;
let locator: Record<string, unknown> | undefined;
afterEach(() => vi.unstubAllEnvs());
const conditional = () =>
  Object.assign(new Error('conditional'), {
    name: 'ConditionalCheckFailedException',
  });
function update(input: UpdateCommand['input']) {
  // DynamoDB reserves TTL; SDK mocks otherwise accept invalid expressions.
  expect(input.ConditionExpression).not.toMatch(/(?<![#:\w])ttl\b/i);
  if (input.ConditionExpression?.includes('#ttl'))
    expect(input.ExpressionAttributeNames?.['#ttl']).toBe('ttl');
  if (input.UpdateExpression?.startsWith('ADD faceIds')) {
    if (!locator) throw conditional();
    const known =
      locator.faceIds instanceof Set ? locator.faceIds : new Set<string>();
    for (const face of input.ExpressionAttributeValues?.[
      ':faces'
    ] as Set<string>)
      known.add(face);
    locator.faceIds = known;
    return { Attributes: locator };
  }
  if (input.ExpressionAttributeValues?.[':status'] && registration)
    registration.status = input.ExpressionAttributeValues[':status'];
  return {};
}
beforeEach(() => {
  db.reset();
  faces.reset();
  objects.reset();
  registration = {
    status: 'UPLOAD_PENDING',
    consentTimestamp: 'yes',
    selfieS3Key: key,
    ttl: Math.floor(Date.now() / 1000) + 600,
  };
  locator = {
    eventId: 'demo',
    registrationId: 'reg',
    selfieS3Key: key,
    cleanupState: 'ACTIVE',
  };
  db.on(GetCommand).callsFake((input) => ({
    Item: input.Key?.SK === 'RETENTION#reg' ? locator : registration,
  }));
  db.on(UpdateCommand).callsFake(update);
  faces.on(CreateCollectionCommand).resolves({});
  faces
    .on(IndexFacesCommand)
    .resolves({ FaceRecords: [{ Face: { FaceId: 'synthetic-face' } }] });
  faces.on(ListFacesCommand).resolves({ Faces: [] });
  faces.on(DeleteFacesCommand).resolves({});
  objects.on(DeleteObjectCommand).resolves({});
});
describe('selfie indexer recovery', () => {
  it('persists the candidate durably before ENROLLED and stores the face GSI', async () => {
    await selfieIndexer(event);
    const calls = db.commandCalls(UpdateCommand);
    expect(calls[1]?.args[0].input.Key).toEqual({
      PK: 'EVENT#demo',
      SK: 'RETENTION#reg',
    });
    expect(
      calls[1]?.args[0].input.ExpressionAttributeValues?.[':faces'],
    ).toEqual(new Set(['synthetic-face']));
    expect(calls[2]?.args[0].input.ExpressionAttributeValues).toMatchObject({
      ':status': 'ENROLLED',
      ':gpk': 'FACE#synthetic-face',
      ':gsk': 'REG#reg',
    });
    expect(calls[2]?.args[0].input.ConditionExpression).toContain(
      'attribute_not_exists(erasureRequestedAt)',
    );
    expect(
      faces.commandCalls(IndexFacesCommand)[0]?.args[0].input,
    ).toMatchObject({
      ExternalImageId: 'reg',
      MaxFaces: 1,
      QualityFilter: 'AUTO',
    });
    expect(
      faces.commandCalls(CreateCollectionCommand)[0]?.args[0].input.Tags,
    ).toMatchObject({ Project: 'findly', DataClass: 'synthetic' });
  });
  it('reuses an existing collection', async () => {
    faces
      .on(CreateCollectionCommand)
      .rejects({ name: 'ResourceAlreadyExistsException' });
    await selfieIndexer(event);
    expect(registration?.status).toBe('ENROLLED');
  });
  it('marks a no-face image FAILED without retrying', async () => {
    faces.on(IndexFacesCommand).resolves({ FaceRecords: [] });
    await selfieIndexer(event);
    expect(registration?.status).toBe('FAILED');
  });
  it('marks malformed images FAILED instead of retrying forever', async () => {
    faces
      .on(IndexFacesCommand)
      .rejects({ name: 'InvalidImageFormatException' });
    await selfieIndexer(event);
    expect(
      db.commandCalls(UpdateCommand)[1]?.args[0].input
        .ExpressionAttributeValues?.[':failed'],
    ).toBe('FAILED');
  });
  it('ignores terminal states and registrations without consent', async () => {
    for (const status of ['ENROLLED', 'FAILED']) {
      if (registration) registration.status = status;
      await selfieIndexer(event);
    }
    registration = {
      status: 'UPLOAD_PENDING',
      selfieS3Key: key,
      ttl: Math.floor(Date.now() / 1000) + 600,
    };
    await selfieIndexer(event);
    expect(faces.calls()).toHaveLength(0);
  });
  it('ignores photos delivered by the shared notification', async () => {
    await selfieIndexer({
      Records: [
        {
          s3: {
            bucket: { name: 'synthetic' },
            object: { key: 'events/demo/photos/photo.photo.jpg' },
          },
        },
        {},
      ],
    });
    expect(db.calls()).toHaveLength(0);
  });
  it('accepts the legacy selfie suffix', async () => {
    const legacy = 'events/demo/selfies/reg.jpg';
    if (registration) registration.selfieS3Key = legacy;
    await selfieIndexer({
      Records: [
        { s3: { bucket: { name: 'synthetic' }, object: { key: legacy } } },
      ],
    });
    expect(
      faces.commandCalls(IndexFacesCommand)[0]?.args[0].input.ExternalImageId,
    ).toBe('reg');
  });
  it('ignores a duplicate claim without indexing twice', async () => {
    db.on(UpdateCommand).rejects(conditional());
    await selfieIndexer(event);
    expect(faces.calls()).toHaveLength(0);
  });
  it('recovers an expired PROCESSING lease using the same immutable object', async () => {
    if (registration) {
      registration.status = 'PROCESSING';
      registration.processingLeaseUntil = 1;
    }
    await selfieIndexer(event);
    expect(registration?.status).toBe('ENROLLED');
    expect(
      db.commandCalls(UpdateCommand)[0]?.args[0].input.ConditionExpression,
    ).toContain('processingLeaseUntil < :now');
  });
  it('propagates transient failures so S3 can retry after lease expiry', async () => {
    faces.on(IndexFacesCommand).rejects({ name: 'ThrottlingException' });
    await expect(selfieIndexer(event)).rejects.toMatchObject({
      name: 'ThrottlingException',
    });
    expect(db.commandCalls(UpdateCommand)).toHaveLength(1);
  });
  it('reconciles a crash-created unknown face when REG was deleted, including pagination', async () => {
    registration = undefined;
    faces
      .on(ListFacesCommand)
      .resolvesOnce({
        Faces: [{ FaceId: 'other-face', ExternalImageId: 'other' }],
        NextToken: 'next',
      })
      .resolvesOnce({
        Faces: [{ FaceId: 'crash-face', ExternalImageId: 'reg' }],
      });
    await selfieIndexer(event);
    expect(
      faces.commandCalls(ListFacesCommand)[1]?.args[0].input.NextToken,
    ).toBe('next');
    expect(
      faces.commandCalls(DeleteFacesCommand)[0]?.args[0].input.FaceIds,
    ).toEqual(['crash-face']);
    expect(
      objects.commandCalls(DeleteObjectCommand)[0]?.args[0].input.Key,
    ).toBe(key);
    expect(faces.commandCalls(IndexFacesCommand)).toHaveLength(0);
    expect(
      db.commandCalls(UpdateCommand).at(-1)?.args[0].input.UpdateExpression,
    ).toContain('DELETE faceIds :faces');
  });
  it('reconciles a live erasure marker and keeps the locator tombstone', async () => {
    if (registration) registration.erasureRequestedAt = 'now';
    if (locator) locator.faceIds = new Set(['tracked-face']);
    await selfieIndexer(event);
    expect(
      faces.commandCalls(DeleteFacesCommand)[0]?.args[0].input.FaceIds,
    ).toEqual(['tracked-face']);
    expect(
      db.commandCalls(UpdateCommand).at(-1)?.args[0].input
        .ExpressionAttributeValues?.[':cleaned'],
    ).toBe('CLEANED');
  });
  it('cleans a candidate if erasure wins immediately after IndexFaces', async () => {
    db.on(UpdateCommand).callsFake((input) => {
      const result = update(input);
      if (input.UpdateExpression?.startsWith('ADD faceIds') && locator)
        locator.cleanupState = 'DELETING';
      return result;
    });
    await selfieIndexer(event);
    expect(
      faces.commandCalls(DeleteFacesCommand)[0]?.args[0].input.FaceIds,
    ).toEqual(['synthetic-face']);
    expect(
      db
        .commandCalls(UpdateCommand)
        .some(
          (call) =>
            call.args[0].input.ExpressionAttributeValues?.[':status'] ===
            'ENROLLED',
        ),
    ).toBe(false);
  });
  it('preserves the deduplicated face committed by a winning worker', async () => {
    db.on(UpdateCommand).callsFake((input) => {
      if (input.ExpressionAttributeValues?.[':status'] === 'ENROLLED') {
        registration = {
          status: 'ENROLLED',
          faceId: 'synthetic-face',
          ttl: Math.floor(Date.now() / 1000) + 600,
        };
        throw conditional();
      }
      return update(input);
    });
    await selfieIndexer(event);
    expect(faces.commandCalls(DeleteFacesCommand)).toHaveLength(0);
  });
  it('retains a durable candidate when another claim still processes the immutable image', async () => {
    db.on(UpdateCommand).callsFake((input) => {
      if (input.ExpressionAttributeValues?.[':status'] === 'ENROLLED') {
        if (registration) registration.status = 'PROCESSING';
        throw conditional();
      }
      return update(input);
    });
    await selfieIndexer(event);
    expect(locator?.faceIds).toEqual(new Set(['synthetic-face']));
    expect(faces.commandCalls(DeleteFacesCommand)).toHaveLength(0);
  });
  it('fails closed on individual DeleteFaces failure and can recover on a later delivery', async () => {
    registration = undefined;
    if (locator) locator.faceIds = new Set(['tracked-face']);
    faces.on(DeleteFacesCommand).resolves({
      UnsuccessfulFaceDeletions: [
        {
          FaceId: 'tracked-face',
          Reasons: ['ASSOCIATED_TO_AN_EXISTING_USER'],
        },
      ],
    });
    await expect(selfieIndexer(event)).rejects.toThrow(
      'FACE_CLEANUP_INCOMPLETE',
    );
    expect(locator?.faceIds).toEqual(new Set(['tracked-face']));
    faces.on(DeleteFacesCommand).resolves({});
    await selfieIndexer(event);
    expect(objects.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });
  it('handles an already removed collection when reconciling missing REG', async () => {
    registration = undefined;
    faces.on(ListFacesCommand).rejects({ name: 'ResourceNotFoundException' });
    await selfieIndexer(event);
    expect(objects.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });
  it('cleans a just-returned FaceId even if its locator disappears before tracking', async () => {
    db.on(UpdateCommand).callsFake((input) => {
      if (input.UpdateExpression?.startsWith('ADD faceIds')) {
        registration = undefined;
        locator = undefined;
        throw conditional();
      }
      return update(input);
    });
    await selfieIndexer(event);
    expect(
      faces.commandCalls(DeleteFacesCommand)[0]?.args[0].input.FaceIds,
    ).toEqual(['synthetic-face']);
    expect(
      objects.commandCalls(DeleteObjectCommand)[0]?.args[0].input.Key,
    ).toBe(key);
  });
  it('never exposes SDK response messages in Lambda failures', async () => {
    faces.on(IndexFacesCommand).rejects(
      Object.assign(new Error('synthetic-sensitive-face@example.invalid'), {
        name: 'ThrottlingException',
      }),
    );
    await expect(selfieIndexer(event)).rejects.toThrow(
      'SELFIE_PROCESSING_FAILED',
    );
  });
  it('fails closed on an existing locator belonging to another collection namespace', async () => {
    vi.stubEnv('FINDLY_COLLECTION_NAMESPACE', 'findly-current-sandbox');
    registration = undefined;
    if (locator) locator.collectionId = 'findly-other-environment-event-demo';
    await expect(selfieIndexer(event)).rejects.toThrow(
      'COLLECTION_OWNERSHIP_UNVERIFIED',
    );
    expect(faces.commandCalls(ListFacesCommand)).toHaveLength(0);
    expect(objects.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });
  it('reconciles a late notification after final purge removed the locator', async () => {
    vi.stubEnv('FINDLY_COLLECTION_NAMESPACE', 'findly-current-sandbox');
    registration = undefined;
    locator = undefined;
    faces.on(ListFacesCommand).resolves({
      Faces: [{ FaceId: 'late-crash-face', ExternalImageId: 'reg' }],
    });
    await selfieIndexer(event);
    expect(
      faces.commandCalls(DeleteFacesCommand)[0]?.args[0].input.FaceIds,
    ).toEqual(['late-crash-face']);
    expect(objects.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });
  it('cleans an expired registration without indexing a late uploaded object', async () => {
    if (registration) registration.ttl = 1;
    await selfieIndexer(event);
    expect(faces.commandCalls(IndexFacesCommand)).toHaveLength(0);
    expect(objects.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });
  it('treats already removed faces and bucket as idempotent cleanup', async () => {
    registration = undefined;
    if (locator) locator.faceIds = new Set(['already-removed-face']);
    faces.on(DeleteFacesCommand).resolves({
      UnsuccessfulFaceDeletions: [
        { FaceId: 'already-removed-face', Reasons: ['FACE_NOT_FOUND'] },
      ],
    });
    objects.on(DeleteObjectCommand).rejects({ name: 'NoSuchBucket' });
    await selfieIndexer(event);
    expect(
      db.commandCalls(UpdateCommand).at(-1)?.args[0].input
        .ExpressionAttributeValues?.[':cleaned'],
    ).toBe('CLEANED');
  });
  it('keeps a known candidate durable when final DynamoDB completion fails', async () => {
    db.on(UpdateCommand).callsFake((input) => {
      if (input.ExpressionAttributeValues?.[':status'] === 'ENROLLED')
        throw Object.assign(new Error('synthetic-sensitive-error'), {
          name: 'InternalServerError',
        });
      return update(input);
    });
    await expect(selfieIndexer(event)).rejects.toMatchObject({
      name: 'InternalServerError',
      message: 'SELFIE_PROCESSING_FAILED',
    });
    expect(locator?.faceIds).toEqual(new Set(['synthetic-face']));
  });
});
