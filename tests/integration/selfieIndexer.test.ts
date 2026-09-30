import { randomUUID } from 'node:crypto';
import {
  CreateTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  CreateCollectionCommand,
  DeleteFacesCommand,
  IndexFacesCommand,
  ListFacesCommand,
  type IndexFacesCommandInput,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import { mockClient } from 'aws-sdk-client-mock';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
let selfieIndexer: typeof import('../../src/lambdas/selfieIndexer').selfieIndexer;
let publicEnrollment: typeof import('../../src/lambdas/publicEnrollment');
import { retentionLocatorKey } from '../../src/shared/lib/retentionCleanup';
import {
  eventKey,
  faceGsi1Key,
  registrationKey,
} from '../../src/shared/lib/dynamoKeys';
import { selfieObjectKey } from '../../src/shared/lib/s3Keys';
import type { RegistrationEntity } from '../../src/shared/types/entities';
import { captureLogs } from '../lambdas/lib/logCapture';
import { createPresignedUploadUrl } from '../../src/lambdas/lib/presignedUpload';

const endpoint = process.env.AWS_ENDPOINT_URL;
if (!endpoint || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint))
  throw new Error('Local Floci endpoint required.');
const options = {
  endpoint,
  region: 'eu-west-1',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
};
const dynamoClient = new DynamoDBClient(options);
const dynamo = DynamoDBDocumentClient.from(dynamoClient);
const s3 = new S3Client({ ...options, forcePathStyle: true });
const rekognition = mockClient(RekognitionClient);
const runId = randomUUID();
const table = `selfie-tests-${runId}`;
const bucket = `selfie-tests-${runId}`;
const syntheticBody =
  'synthetic test object: Rekognition is mocked, this is not a facial image';
type Fixture = RegistrationEntity & { PK: string; SK: string };
let logs: ReturnType<typeof captureLogs>;

async function seed(
  overrides: Partial<RegistrationEntity> = {},
): Promise<Fixture> {
  const eventId = `evt-${randomUUID()}`;
  const registrationId = `reg-${randomUUID()}`;
  const item: Fixture = {
    ...registrationKey(eventId, registrationId),
    eventId,
    registrationId,
    selfieS3Key: selfieObjectKey(eventId, registrationId),
    consentTimestamp: new Date(Date.now() - 1000).toISOString(),
    status: 'UPLOAD_PENDING',
    ttl: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
  await dynamo.send(new PutCommand({ TableName: table, Item: item }));
  await dynamo.send(
    new PutCommand({
      TableName: table,
      Item: {
        ...retentionLocatorKey(eventId, registrationId),
        eventId,
        registrationId,
        selfieS3Key: item.selfieS3Key,
        collectionId: `findly-test-event-${eventId}`,
        cleanupState: 'ACTIVE',
      },
    }),
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: item.selfieS3Key,
      Body: syntheticBody,
      ContentType: 'image/jpeg',
    }),
  );
  return item;
}
const read = async (fixture: Fixture) =>
  (
    await dynamo.send(
      new GetCommand({
        TableName: table,
        Key: { PK: fixture.PK, SK: fixture.SK },
        ConsistentRead: true,
      }),
    )
  ).Item;
const event = (fixture: Fixture): Parameters<typeof selfieIndexer>[0] => ({
  Records: [
    {
      s3: {
        bucket: { name: bucket },
        object: { key: encodeURIComponent(fixture.selfieS3Key) },
      },
    },
  ],
});

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

beforeAll(async () => {
  vi.stubEnv('TABLE_NAME', table);
  vi.stubEnv('FINDLY_TABLE_NAME', table);
  vi.stubEnv('FINDLY_SELFIE_BUCKET', bucket);
  vi.stubEnv('FINDLY_PHOTO_BUCKET', bucket);
  vi.stubEnv('FINDLY_COLLECTION_NAMESPACE', 'findly-test');
  ({ selfieIndexer } = await import('../../src/lambdas/selfieIndexer'));
  publicEnrollment = await import('../../src/lambdas/publicEnrollment');
  await dynamoClient.send(
    new CreateTableCommand({
      TableName: table,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: ['PK', 'SK', 'GSI1PK', 'GSI1SK'].map(
        (AttributeName) => ({ AttributeName, AttributeType: 'S' }),
      ),
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
  await waitUntilTableExists(
    { client: dynamoClient, maxWaitTime: 10, minDelay: 1, maxDelay: 1 },
    { TableName: table },
  );
  await s3.send(
    new CreateBucketCommand({
      Bucket: bucket,
      CreateBucketConfiguration: { LocationConstraint: 'eu-west-1' },
    }),
  );
});

beforeEach(() => {
  logs = captureLogs();
  rekognition.reset();
  rekognition.on(CreateCollectionCommand).resolves({});
  rekognition.on(DeleteFacesCommand).resolves({});
  rekognition.on(ListFacesCommand).resolves({ Faces: [] });
  rekognition
    .on(IndexFacesCommand)
    .callsFake(async (input: IndexFacesCommandInput) => {
      const image = input.Image?.S3Object;
      const object = await s3.send(
        new GetObjectCommand({ Bucket: image?.Bucket, Key: image?.Name }),
      );
      expect(await object.Body?.transformToString()).toBe(syntheticBody);
      return {
        FaceRecords: [
          { Face: { FaceId: `synthetic-${input.ExternalImageId}` } },
        ],
      };
    });
});
afterEach(() => {
  logs.restore();
});
afterAll(() => {
  rekognition.restore();
  vi.unstubAllEnvs();
  dynamoClient.destroy();
  s3.destroy();
  // The runner removes this run's entire container, including failed-test fixtures.
});

describe('SelfieIndexer — Floci DynamoDB/S3, mocked Rekognition, explicit S3 event', () => {
  it.each(['ENROLLED', 'FAILED'] as const)(
    'runs public registration, signed PUT, indexing and authorized polling to %s',
    async (status) => {
      const eventId = `evt-${randomUUID()}`;
      await dynamo.send(
        new PutCommand({
          TableName: table,
          Item: {
            ...eventKey(eventId),
            eventId,
            status: 'OPEN',
            createdAt: new Date().toISOString(),
            retentionDays: 30,
          },
        }),
      );
      const response = await publicEnrollment.createPublicRegistration({
        pathParameters: { eventId },
        body: JSON.stringify({ consentBiometrics: true, consentTerms: true }),
      });
      expect(response.statusCode).toBe(201);
      const grant = JSON.parse(response.body) as {
        registrationId: string;
        galleryToken: string;
        uploadUrl: string;
      };
      const fixture = {
        ...registrationKey(eventId, grant.registrationId),
        eventId,
        registrationId: grant.registrationId,
        selfieS3Key: selfieObjectKey(eventId, grant.registrationId),
      };
      const poll = (token: string) =>
        publicEnrollment.getPublicRegistrationStatus({
          pathParameters: { registrationId: grant.registrationId },
          headers: { 'x-gallery-token': token },
        });
      expect(JSON.parse((await poll(grant.galleryToken)).body)).toMatchObject({
        status: 'UPLOAD_PENDING',
      });
      expect((await poll('wrong-synthetic-token')).statusCode).toBe(404);
      expect(
        (
          await fetch(grant.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' },
            body: syntheticBody,
          })
        ).status,
      ).toBe(200);
      if (status === 'FAILED')
        rekognition.on(IndexFacesCommand).resolves({
          FaceRecords: [],
          UnindexedFaces: [{ Reasons: ['LOW_SHARPNESS'] }],
        });
      await selfieIndexer({
        Records: [
          {
            s3: {
              bucket: { name: bucket },
              object: { key: encodeURIComponent(fixture.selfieS3Key) },
            },
          },
        ],
      });
      expect(JSON.parse((await poll(grant.galleryToken)).body)).toEqual({
        registrationId: grant.registrationId,
        status,
      });
      const locator = (
        await dynamo.send(
          new GetCommand({
            TableName: table,
            Key: retentionLocatorKey(eventId, grant.registrationId),
            ConsistentRead: true,
          }),
        )
      ).Item;
      expect(locator).toMatchObject({
        cleanupState: 'ACTIVE',
        collectionId: `findly-test-event-${eventId}`,
      });
      expect(locator).not.toHaveProperty('ttl');
      if (status === 'ENROLLED')
        expect(locator?.faceIds).toEqual(
          new Set([`synthetic-${grant.registrationId}`]),
        );
    },
  );

  it('retains a face after cleanup failure and reconciles the next delivery without enrolling', async () => {
    const fixture = await seed();
    rekognition.on(IndexFacesCommand).callsFake(async () => {
      await dynamo.send(
        new UpdateCommand({
          TableName: table,
          Key: retentionLocatorKey(fixture.eventId, fixture.registrationId),
          UpdateExpression: 'SET cleanupState = :state',
          ExpressionAttributeValues: { ':state': 'DELETING' },
        }),
      );
      await dynamo.send(
        new UpdateCommand({
          TableName: table,
          Key: { PK: fixture.PK, SK: fixture.SK },
          UpdateExpression: 'SET erasureRequestedAt = :now',
          ExpressionAttributeValues: { ':now': new Date().toISOString() },
        }),
      );
      return { FaceRecords: [{ Face: { FaceId: 'synthetic-erasure' } }] };
    });
    rekognition
      .on(DeleteFacesCommand)
      .rejectsOnce(new Error('synthetic-cleanup-failure'))
      .resolves({});
    await expect(selfieIndexer(event(fixture))).rejects.toThrow(
      'SELFIE_PROCESSING_FAILED',
    );
    const locator = () =>
      dynamo.send(
        new GetCommand({
          TableName: table,
          Key: retentionLocatorKey(fixture.eventId, fixture.registrationId),
          ConsistentRead: true,
        }),
      );
    expect((await locator()).Item?.faceIds).toEqual(
      new Set(['synthetic-erasure']),
    );
    await selfieIndexer(event(fixture));
    expect((await locator()).Item).toMatchObject({ cleanupState: 'CLEANED' });
    expect((await locator()).Item).not.toHaveProperty('faceIds');
    expect(await read(fixture)).not.toHaveProperty('faceId');
    expect(rekognition.commandCalls(IndexFacesCommand)).toHaveLength(1);
    await expect(
      s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: fixture.selfieS3Key }),
      ),
    ).rejects.toMatchObject({ name: 'NoSuchKey' });
  });
  it('signs conditional selfie PUTs: first succeeds, overwrite fails, another registration succeeds', async () => {
    const key = selfieObjectKey(`evt-${randomUUID()}`, `reg-${randomUUID()}`);
    const signed = await createPresignedUploadUrl({
      bucket,
      key,
      contentType: 'image/jpeg',
      writeOnce: true,
    });
    expect(
      new URL(signed.uploadUrl).searchParams
        .get('X-Amz-SignedHeaders')
        ?.split(';'),
    ).toContain('if-none-match');
    const put = (url: string, body: string) =>
      fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' },
        body,
      });
    expect((await put(signed.uploadUrl, 'first synthetic object')).status).toBe(
      200,
    );
    expect((await put(signed.uploadUrl, 'replacement')).status).toBe(412);
    const object = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    expect(await object.Body?.transformToString()).toBe(
      'first synthetic object',
    );
    const other = await createPresignedUploadUrl({
      bucket,
      key: key.replace(/reg-[^.]+/, `reg-${randomUUID()}`),
      contentType: 'image/jpeg',
      writeOnce: true,
    });
    expect(
      (await put(other.uploadUrl, 'another synthetic object')).status,
    ).toBe(200);
  });

  it('reads the uploaded object and persists ENROLLED plus a queryable GSI1 mapping', async () => {
    const fixture = await seed();
    await selfieIndexer(event(fixture));
    const stored = await read(fixture);
    const faceId = `synthetic-${fixture.registrationId}`;
    expect(stored).toMatchObject({
      ...fixture,
      status: 'ENROLLED',
      faceId,
      ...faceGsi1Key(faceId, fixture.registrationId),
    });
    expect(stored).not.toHaveProperty('processingClaim');
    expect(stored).not.toHaveProperty('processingLeaseUntil');
    await expect
      .poll(
        async () =>
          (
            await dynamo.send(
              new QueryCommand({
                TableName: table,
                IndexName: 'GSI1',
                KeyConditionExpression: 'GSI1PK = :face',
                ExpressionAttributeValues: { ':face': `FACE#${faceId}` },
              }),
            )
          ).Items,
        { timeout: 5000 },
      )
      .toEqual([
        expect.objectContaining({ registrationId: fixture.registrationId }),
      ]);
  });

  it('does not index again when S3 redelivers a completed registration', async () => {
    const fixture = await seed();
    await selfieIndexer(event(fixture));
    const first = await read(fixture);
    await selfieIndexer(event(fixture));
    expect(await read(fixture)).toEqual(first);
    expect(rekognition.commandCalls(IndexFacesCommand)).toHaveLength(1);
    expect(rekognition.commandCalls(CreateCollectionCommand)).toHaveLength(1);
  });

  it('persists FAILED for an unusable face and does not retry that terminal result', async () => {
    const fixture = await seed();
    rekognition.on(IndexFacesCommand).resolves({
      FaceRecords: [],
      UnindexedFaces: [{ Reasons: ['LOW_SHARPNESS'] }],
    });
    await selfieIndexer(event(fixture));
    await selfieIndexer(event(fixture));
    expect(await read(fixture)).toMatchObject({
      status: 'FAILED',
      ttl: fixture.ttl,
    });
    expect(await read(fixture)).not.toHaveProperty('faceId');
    expect(rekognition.commandCalls(IndexFacesCommand)).toHaveLength(1);
  });

  it('admits only one concurrent indexer using the real conditional write', async () => {
    const fixture = await seed();
    const entered = gate();
    const finish = gate();
    rekognition.on(IndexFacesCommand).callsFake(async () => {
      entered.release();
      await finish.promise;
      return { FaceRecords: [{ Face: { FaceId: 'synthetic-concurrent' } }] };
    });
    const first = selfieIndexer(event(fixture));
    try {
      await Promise.race([
        entered.promise,
        first.then(() => {
          throw new Error(
            'The handler completed without entering Rekognition.',
          );
        }),
      ]);
      expect(await read(fixture)).toMatchObject({ status: 'PROCESSING' });
      await selfieIndexer(event(fixture));
      expect(rekognition.commandCalls(IndexFacesCommand)).toHaveLength(1);
    } finally {
      finish.release();
      await first;
    }
    await selfieIndexer(event(fixture));
    expect(await read(fixture)).toMatchObject({
      status: 'ENROLLED',
      faceId: 'synthetic-concurrent',
    });
    expect(rekognition.commandCalls(IndexFacesCommand)).toHaveLength(1);
  });

  it('recovers a failed attempt after lease expiry without extending retention', async () => {
    const fixture = await seed();
    rekognition
      .on(IndexFacesCommand)
      .rejectsOnce(
        Object.assign(new Error('synthetic throttling'), {
          name: 'ThrottlingException',
        }),
      )
      .resolves({ FaceRecords: [{ Face: { FaceId: 'synthetic-recovered' } }] });
    await expect(selfieIndexer(event(fixture))).rejects.toThrow(
      'SELFIE_PROCESSING_FAILED',
    );
    expect(await read(fixture)).toMatchObject({
      status: 'PROCESSING',
      ttl: fixture.ttl,
    });
    await selfieIndexer(event(fixture));
    expect(rekognition.commandCalls(IndexFacesCommand)).toHaveLength(1);
    // Exercise lease expiry without waiting 30 seconds or faking the SDK signing clock.
    await dynamo.send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: fixture.PK, SK: fixture.SK },
        UpdateExpression: 'SET processingLeaseUntil = :expired',
        ExpressionAttributeValues: {
          ':expired': Date.now() - 1,
        },
      }),
    );
    await selfieIndexer(event(fixture));
    expect(await read(fixture)).toMatchObject({
      status: 'ENROLLED',
      faceId: 'synthetic-recovered',
      ttl: fixture.ttl,
    });
    expect(rekognition.commandCalls(IndexFacesCommand)).toHaveLength(2);
  });

  it('does not recreate a registration deleted while Rekognition is processing', async () => {
    const fixture = await seed();
    rekognition.on(IndexFacesCommand).callsFake(async () => {
      await dynamo.send(
        new DeleteCommand({
          TableName: table,
          Key: { PK: fixture.PK, SK: fixture.SK },
        }),
      );
      return { FaceRecords: [{ Face: { FaceId: 'synthetic-erased' } }] };
    });
    await selfieIndexer(event(fixture));
    expect(await read(fixture)).toBeUndefined();
    expect(
      rekognition.commandCalls(DeleteFacesCommand)[0]?.args[0].input,
    ).toEqual({
      CollectionId: `findly-test-event-${fixture.eventId}`,
      FaceIds: ['synthetic-erased'],
    });
  });

  it.each([
    { consentTimestamp: '' },
    { ttl: Math.floor(Date.now() / 1000) - 1 },
  ])('leaves ineligible registrations untouched: %j', async (overrides) => {
    const fixture = await seed(overrides);
    await selfieIndexer(event(fixture));
    expect(await read(fixture)).toEqual(fixture);
    expect(rekognition.commandCalls(IndexFacesCommand)).toHaveLength(0);
  });

  it('does not create a registration from an unsolicited object notification', async () => {
    const fixture = await seed();
    await dynamo.send(
      new DeleteCommand({
        TableName: table,
        Key: { PK: fixture.PK, SK: fixture.SK },
      }),
    );
    await selfieIndexer(event(fixture));
    expect(await read(fixture)).toBeUndefined();
    expect(rekognition.commandCalls(IndexFacesCommand)).toHaveLength(0);
  });

  it('keeps the stored inscription consistent when its collection already exists', async () => {
    const fixture = await seed();
    rekognition.on(CreateCollectionCommand).rejects(
      Object.assign(new Error('synthetic existing collection'), {
        name: 'ResourceAlreadyExistsException',
      }),
    );
    await selfieIndexer(event(fixture));
    expect(await read(fixture)).toMatchObject({ status: 'ENROLLED' });
  });
});
