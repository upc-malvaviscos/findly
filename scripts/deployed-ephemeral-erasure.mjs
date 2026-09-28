import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import {
  ephemeralCollectionId,
  requireEphemeralCollectionNamespace,
} from './lib/ephemeralCollections.mjs';

requireEphemeralCollectionNamespace();

const api = process.env.EPHEMERAL_API_ENDPOINT?.replace(/\/$/, '');
const table =
  process.env.EPHEMERAL_TABLE_NAME ?? process.env.EPHEMERAL_DYNAMODB_TABLE_NAME;
const bucket = process.env.EPHEMERAL_UPLOADS_BUCKET_NAME;
const functionName = process.env.EPHEMERAL_RETENTION_FUNCTION_NAME;
if (!api || !table || !bucket || !functionName)
  throw new Error(
    'Erasure smoke requires API, table, uploads bucket and retention function outputs.',
  );
const options = { region: process.env.AWS_REGION ?? 'eu-west-1' };
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(options));
const s3 = new S3Client(options);
const lambda = new LambdaClient(options);
const items = [];
const objects = [];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const put = async (item) => {
  items.push({ PK: item.PK, SK: item.SK });
  await dynamo.send(new PutCommand({ TableName: table, Item: item }));
};
const get = async (key) =>
  (
    await dynamo.send(
      new GetCommand({ TableName: table, Key: key, ConsistentRead: true }),
    )
  ).Item;
const image = async (key) => {
  objects.push(key);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: 'image/jpeg',
      Body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    }),
  );
};
async function seed(expired) {
  const eventId = `evt-erasure-${randomUUID()}`;
  const registrationId = `reg-${randomUUID()}`;
  const photoId = randomUUID();
  const token = randomUUID();
  const now = new Date();
  const createdAt = new Date(
    now.getTime() - (expired ? 3 : 0) * 86400000,
  ).toISOString();
  const eventKey = { PK: `EVENT#${eventId}`, SK: 'METADATA' };
  const regKey = { PK: eventKey.PK, SK: `REG#${registrationId}` };
  const locatorKey = { PK: eventKey.PK, SK: `RETENTION#${registrationId}` };
  const tokenKey = { PK: `TOKEN#${hash(token)}`, SK: 'METADATA' };
  const matchKey = { PK: `REG#${registrationId}`, SK: `MATCH#${photoId}` };
  const photoKey = { PK: eventKey.PK, SK: `PHOTO#${photoId}` };
  const selfie = `events/${eventId}/selfies/${registrationId}.jpg`;
  const photo = `events/${eventId}/photos/${photoId}.jpg`;
  // No FaceId is invented. These bytes exercise storage only, not biometric enrollment.
  await put({
    ...eventKey,
    eventId,
    name: 'Synthetic erasure',
    date: now.toISOString(),
    createdAt,
    retentionDays: 1,
    status: 'OPEN',
    GSI2PK: 'ENTITY#EVENT',
    GSI2SK: `${now.toISOString()}#${eventId}`,
  });
  await put({
    ...regKey,
    eventId,
    registrationId,
    tokenHash: hash(token),
    status: 'ENROLLED',
    consentTimestamp: now.toISOString(),
    selfieS3Key: selfie,
    ttl: Math.floor(now.getTime() / 1000) + 3600,
  });
  await put({
    ...tokenKey,
    eventId,
    registrationId,
    tokenHash: hash(token),
    expiresAt: new Date(now.getTime() + 3600000).toISOString(),
    ttl: Math.floor(now.getTime() / 1000) + 3600,
  });
  await put({
    ...locatorKey,
    eventId,
    registrationId,
    tokenHash: hash(token),
    selfieS3Key: selfie,
    collectionId: ephemeralCollectionId(eventId),
    cleanupState: 'ACTIVE',
    uploadExpiresAt:
      Math.floor(now.getTime() / 1000) + (expired ? -86400 : 300),
    ...(expired ? { cleanupAfter: Math.floor(now.getTime() / 1000) - 1 } : {}),
  });
  await put({
    ...matchKey,
    eventId,
    registrationId,
    photoId,
    similarity: 99,
    matchedAt: now.toISOString(),
  });
  await put({
    ...photoKey,
    eventId,
    photoId,
    s3Key: photo,
    uploadedAt: now.toISOString(),
  });
  await image(selfie);
  await image(photo);
  return {
    eventId,
    registrationId,
    token,
    eventKey,
    regKey,
    locatorKey,
    tokenKey,
    matchKey,
    photoKey,
    selfie,
    photo,
  };
}
async function absentObject(key) {
  const result = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: key, MaxKeys: 1 }),
  );
  assert.ok(
    !result.Contents?.some((object) => object.Key === key),
    'An erased synthetic object still exists.',
  );
}
async function status(path, expected, init) {
  const response = await fetch(`${api}${path}`, init);
  assert.equal(response.status, expected, 'Unexpected deployed HTTP status.');
}
try {
  const individual = await seed(false);
  await status(`/gallery?token=${encodeURIComponent(individual.token)}`, 200);
  const erase = (token) => ({
    method: 'DELETE',
    headers: { 'X-Gallery-Token': token },
  });
  await status(
    `/registrations/${individual.registrationId}`,
    404,
    erase(randomUUID()),
  );
  assert.ok(
    await get(individual.regKey),
    'Wrong token must preserve registration.',
  );
  await status(
    `/registrations/${individual.registrationId}`,
    204,
    erase(individual.token),
  );
  await status(`/gallery?token=${encodeURIComponent(individual.token)}`, 404);
  await status(
    `/registrations/${individual.registrationId}`,
    404,
    erase(individual.token),
  );
  for (const key of [
    individual.regKey,
    individual.matchKey,
    individual.tokenKey,
  ])
    assert.equal(await get(key), undefined);
  await absentObject(individual.selfie);
  const tombstone = await get(individual.locatorKey);
  assert.equal(tombstone.cleanupState, 'CLEANED');
  assert.equal(tombstone.ttl, undefined);
  assert.equal(tombstone.tokenHash, undefined);

  const expired = await seed(true);
  const active = await seed(false);
  // Simulate the TTL race deterministically; this does not test the TTL scheduler.
  await dynamo.send(
    new DeleteCommand({ TableName: table, Key: expired.regKey }),
  );
  assert.equal(await get(expired.regKey), undefined);
  // GSI propagation is eventual: wait boundedly before manual invocation.
  let visible = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: table,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK = :sk',
        ExpressionAttributeValues: {
          ':pk': 'ENTITY#EVENT',
          ':sk': (await get(expired.eventKey)).GSI2SK,
        },
      }),
    );
    if (page.Items?.length) {
      visible = true;
      break;
    }
    await pause(1000);
  }
  assert.ok(
    visible,
    'Expired fixture was not visible in GSI2 within 30 seconds.',
  );
  const invocation = await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from('{}'),
    }),
  );
  assert.equal(
    invocation.FunctionError,
    undefined,
    'Retention Lambda invocation failed.',
  );
  for (const key of [
    expired.eventKey,
    expired.regKey,
    expired.matchKey,
    expired.tokenKey,
    expired.photoKey,
    expired.locatorKey,
  ])
    assert.equal(await get(key), undefined);
  await absentObject(expired.selfie);
  await absentObject(expired.photo);
  for (const key of [
    active.eventKey,
    active.regKey,
    active.matchKey,
    active.tokenKey,
    active.photoKey,
    active.locatorKey,
  ])
    assert.ok(
      await get(key),
      'Active event data must survive retention purge.',
    );
  await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: active.selfie }));
  console.log(
    'AWS erasure and manual retention invocation passed. FaceId cleanup and real Scheduler execution are not verified by this smoke.',
  );
} finally {
  // Only fixtures created by this process are eligible for cleanup.
  for (const key of objects)
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  for (const key of items)
    await dynamo.send(new DeleteCommand({ TableName: table, Key: key }));
}
