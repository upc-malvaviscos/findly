// DynamoDB/S3 are emulated by an isolated Floci container; only Rekognition
// is mocked. The commit gate pauses a real handler after face resolution.
import { randomUUID } from 'node:crypto';
import { CreateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CreateBucketCommand,
  PutObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  DeleteFacesCommand,
  IndexFacesCommand,
  RekognitionClient,
  SearchFacesCommand,
} from '@aws-sdk/client-rekognition';
import { mockClient } from 'aws-sdk-client-mock';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';
import {
  eventKey,
  faceGsi1Key,
  matchKey,
  photoKey,
  photoMatchPartitionKey,
  registrationKey,
} from '../../src/shared/lib/dynamoKeys';
import { eventPhotoObjectKey } from '../../src/shared/lib/s3Keys';

const endpoint = process.env.AWS_ENDPOINT_URL;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint ?? ''))
  throw new Error('Floci required');
const options = {
  endpoint,
  region: 'eu-west-1',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
};
const client = new DynamoDBClient(options);
const db = DynamoDBDocumentClient.from(client);
const s3 = new S3Client({ ...options, forcePathStyle: true });
const rekognition = mockClient(RekognitionClient);
const table = `photo-barrier-${randomUUID()}`;
const bucket = `photo-barrier-${randomUUID()}`;
const registrationId = '11111111-1111-4111-8111-111111111111';
let matching: typeof import('../../src/lambdas/lib/matching');
let admin: typeof import('../../src/lambdas/adminEvents');
let photoMatcher: typeof import('../../src/lambdas/photoMatcher').photoMatcher;
let backfill: typeof import('../../src/lambdas/registrationBackfill').registrationBackfill;
let eventId: string;
let photoId: string;
let ttl: number;
let enrolledFace: string;
let adminClient: DynamoDBDocumentClient;

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
const readPhoto = async () =>
  (
    await db.send(
      new GetCommand({
        TableName: table,
        Key: photoKey(eventId, photoId),
        ConsistentRead: true,
      }),
    )
  ).Item;
const removePhoto = () =>
  admin.deleteEventPhoto({ pathParameters: { eventId, photoId } });
async function assertNoMatches() {
  expect(
    (
      await db.send(
        new GetCommand({
          TableName: table,
          Key: matchKey(registrationId, photoId),
          ConsistentRead: true,
        }),
      )
    ).Item,
  ).toBeUndefined();
  expect(
    (
      await db.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: {
            ':pk': photoMatchPartitionKey(eventId, photoId),
          },
          ConsistentRead: true,
        }),
      )
    ).Items,
  ).toEqual([]);
}
async function runTrigger(trigger: 'photo' | 'backfill') {
  const result =
    trigger === 'photo'
      ? await photoMatcher({
          Records: [
            {
              messageId: 'synthetic-photo-message',
              body: JSON.stringify({
                Records: [
                  {
                    s3: {
                      bucket: { name: bucket },
                      object: { key: eventPhotoObjectKey(eventId, photoId) },
                    },
                  },
                ],
              }),
            },
          ],
        })
      : await backfill({
          Records: [
            {
              messageId: 'synthetic-backfill-message',
              body: JSON.stringify({ eventId, registrationId }),
            },
          ],
        });
  expect(result.batchItemFailures).toEqual([]);
}

beforeAll(async () => {
  vi.stubEnv('FINDLY_TABLE_NAME', table);
  vi.stubEnv('FINDLY_PHOTO_BUCKET', bucket);
  vi.stubEnv('FINDLY_COLLECTION_NAMESPACE', 'findly-test');
  matching = await import('../../src/lambdas/lib/matching');
  await import('../../src/lambdas/lib/eventCleanup');
  const from = DynamoDBDocumentClient.from.bind(DynamoDBDocumentClient);
  const clients: DynamoDBDocumentClient[] = [];
  const capture = vi
    .spyOn(DynamoDBDocumentClient, 'from')
    .mockImplementation((...args) => {
      const documentClient = from(...args);
      clients.push(documentClient);
      return documentClient;
    });
  try {
    admin = await import('../../src/lambdas/adminEvents');
  } finally {
    capture.mockRestore();
  }
  expect(clients).toHaveLength(1);
  adminClient = clients[0]!;
  ({ photoMatcher } = await import('../../src/lambdas/photoMatcher'));
  ({ registrationBackfill: backfill } =
    await import('../../src/lambdas/registrationBackfill'));
  await client.send(
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
  await s3.send(
    new CreateBucketCommand({
      Bucket: bucket,
      CreateBucketConfiguration: { LocationConstraint: 'eu-west-1' },
    }),
  );
});
beforeEach(async (context) => {
  eventId = `synthetic-${randomUUID()}`;
  enrolledFace = `${eventId}-enrolled-face`;
  rekognition.reset();
  rekognition
    .on(IndexFacesCommand)
    .resolves({ FaceRecords: [{ Face: { FaceId: 'temporary-face' } }] });
  rekognition.on(SearchFacesCommand).resolves({
    FaceMatches: [{ Face: { FaceId: enrolledFace }, Similarity: 99 }],
  });
  rekognition.on(DeleteFacesCommand).resolves({});
  photoId = randomUUID();
  ttl = Math.floor(Date.now() / 1000) + 3600;
  const items = [
    {
      ...eventKey(eventId),
      eventId,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      retentionDays: 30,
    },
    {
      ...registrationKey(eventId, registrationId),
      ...faceGsi1Key(enrolledFace, registrationId),
      eventId,
      registrationId,
      status: 'ENROLLED',
      faceId: enrolledFace,
      ttl,
    },
    {
      ...photoKey(eventId, photoId),
      eventId,
      photoId,
      ttl,
      s3Key: eventPhotoObjectKey(eventId, photoId),
      fileName: 'synthetic.jpg',
      uploadedAt: new Date().toISOString(),
    },
  ];
  const ordered = context.task.name.startsWith('backfill')
    ? [items[0]!, items[2]!, items[1]!]
    : items;
  // Invoke triggers explicitly: this suite does not emulate S3 notifications.
  for (const Item of ordered)
    await db.send(new PutCommand({ TableName: table, Item }));
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: eventPhotoObjectKey(eventId, photoId),
      Body: 'synthetic fixture; Rekognition mocked',
    }),
  );
});
afterEach(() => {
  matching.dynamo.middlewareStack.remove('pausePhotoCommit');
  adminClient.middlewareStack.remove('pauseDeletion');
  adminClient.middlewareStack.remove('interruptCleanup');
});
afterAll(() => {
  rekognition.restore();
  vi.unstubAllEnvs();
  client.destroy();
  s3.destroy();
});

it.each(['photo', 'backfill'] as const)(
  '%s: paused before commit, deleted, resumed and redelivered leaves no match or mirror',
  async (trigger) => {
    const reached = gate();
    const resume = gate();
    matching.dynamo.middlewareStack.add(
      (next) => async (args) => {
        if ('TransactItems' in args.input) {
          reached.release();
          await resume.promise;
        }
        return next(args);
      },
      { step: 'initialize', name: 'pausePhotoCommit' },
    );
    const pending = runTrigger(trigger);
    try {
      await reached.promise;
      expect((await removePhoto()).statusCode).toBe(204);
    } finally {
      resume.release();
    }
    await pending;
    await assertNoMatches();
    await expect(
      s3.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: eventPhotoObjectKey(eventId, photoId),
        }),
      ),
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect(rekognition.commandCalls(DeleteFacesCommand)).toHaveLength(1);
    await runTrigger(trigger);
    await assertNoMatches();
    const photo = await readPhoto();
    expect(photo?.ttl).toBe(ttl);
    expect(photo?.deletedAt).toEqual(expect.any(String));
    expect(photo).not.toHaveProperty('s3Key');
    const retry = await admin.createPhotoUploads({
      pathParameters: { eventId },
      body: JSON.stringify({
        files: [
          {
            operationId: photoId,
            fileName: 'synthetic.jpg',
            contentType: 'image/jpeg',
          },
        ],
      }),
    });
    expect(JSON.parse(retry.body).uploads).toEqual([
      { photoId, error: 'PHOTO_DELETED' },
    ]);
    await removePhoto();
    expect((await readPhoto())?.deletedAt).toBe(photo?.deletedAt);
  },
);

it.each(['photo', 'backfill'] as const)(
  '%s: a match committed before the barrier is found and removed',
  async (trigger) => {
    await runTrigger(trigger);
    expect(
      (
        await db.send(
          new GetCommand({
            TableName: table,
            Key: matchKey(registrationId, photoId),
          }),
        )
      ).Item,
    ).toBeDefined();
    await removePhoto();
    await assertNoMatches();
  },
);

it.each(['tombstone', 'expired', 'missing'] as const)(
  'rejects %s at the transaction even when the Photo row has not been purged',
  async (state) => {
    if (state === 'tombstone')
      await db.send(
        new UpdateCommand({
          TableName: table,
          Key: photoKey(eventId, photoId),
          UpdateExpression: 'SET deletedAt = :v',
          ExpressionAttributeValues: { ':v': 'synthetic-deletion' },
        }),
      );
    if (state === 'expired')
      await db.send(
        new UpdateCommand({
          TableName: table,
          Key: photoKey(eventId, photoId),
          UpdateExpression: 'SET #ttl = :v',
          ExpressionAttributeNames: { '#ttl': 'ttl' },
          ExpressionAttributeValues: { ':v': Math.floor(Date.now() / 1000) },
        }),
      );
    if (state === 'missing') photoId = randomUUID();
    await matching.writeMatch(
      eventId,
      registrationId,
      photoId,
      99,
      ttl,
      enrolledFace,
    );
    await assertNoMatches();
  },
);

it('does not send a tombstone or expired row to Rekognition from backfill', async () => {
  await removePhoto();
  await runTrigger('backfill');
  expect(rekognition.commandCalls(IndexFacesCommand)).toHaveLength(0);
  expect(rekognition.commandCalls(DeleteFacesCommand)).toHaveLength(0);
});

it.each(['photo', 'backfill'] as const)(
  '%s: commit during cleanup is rejected while the mirror query is paused after the barrier',
  async (trigger) => {
    const reached = gate();
    const resume = gate();
    adminClient.middlewareStack.add(
      (next) => async (args) => {
        if ('KeyConditionExpression' in args.input) {
          reached.release();
          await resume.promise;
        }
        return next(args);
      },
      { step: 'initialize', name: 'pauseDeletion' },
    );
    const deletion = removePhoto();
    try {
      await reached.promise;
      expect((await readPhoto())?.deletedAt).toEqual(expect.any(String));
      // Direct write models a matcher that already resolved a face pre-barrier.
      await matching.writeMatch(
        eventId,
        registrationId,
        photoId,
        99,
        ttl,
        enrolledFace,
      );
      await runTrigger(trigger);
      await assertNoMatches();
    } finally {
      resume.release();
    }
    expect((await deletion).statusCode).toBe(204);
    await assertNoMatches();
  },
);

it('an interruption after forward deletion keeps discovery mirrors and converges with the same tombstone', async () => {
  await runTrigger('photo');
  let interrupted = false;
  adminClient.middlewareStack.add(
    (next) => async (args) => {
      const response = await next(args);
      if ('RequestItems' in args.input && !interrupted) {
        interrupted = true;
        throw new Error(
          'synthetic interruption after a completed forward batch',
        );
      }
      return response;
    },
    { step: 'initialize', name: 'interruptCleanup' },
  );
  await expect(removePhoto()).rejects.toThrow('synthetic interruption');
  const marker = await readPhoto();
  const remaining = await db.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': photoMatchPartitionKey(eventId, photoId),
      },
      ConsistentRead: true,
    }),
  );
  expect(remaining.Items).toHaveLength(1);
  expect((await removePhoto()).statusCode).toBe(204);
  await assertNoMatches();
  expect((await readPhoto())?.deletedAt).toBe(marker?.deletedAt);
  expect((await readPhoto())?.ttl).toBe(ttl);
});

it.each(['photo', 'backfill'] as const)(
  '%s: TTL changed after face resolution is revalidated in the commit',
  async (trigger) => {
    const reached = gate();
    const resume = gate();
    matching.dynamo.middlewareStack.add(
      (next) => async (args) => {
        if ('TransactItems' in args.input) {
          reached.release();
          await resume.promise;
        }
        return next(args);
      },
      { step: 'initialize', name: 'pausePhotoCommit' },
    );
    const pending = runTrigger(trigger);
    try {
      await reached.promise;
      await db.send(
        new UpdateCommand({
          TableName: table,
          Key: photoKey(eventId, photoId),
          UpdateExpression: 'SET #ttl = :v',
          ExpressionAttributeNames: { '#ttl': 'ttl' },
          ExpressionAttributeValues: {
            ':v': Math.floor(Date.now() / 1000) - 1,
          },
        }),
      );
    } finally {
      resume.release();
    }
    await pending;
    await assertNoMatches();
    expect(rekognition.commandCalls(DeleteFacesCommand)).toHaveLength(1);
    rekognition.resetHistory();
    await runTrigger('backfill');
    expect(rekognition.commandCalls(IndexFacesCommand)).toHaveLength(0);
  },
);
