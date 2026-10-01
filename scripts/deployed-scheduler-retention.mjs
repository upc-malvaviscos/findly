import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  DynamoDBClient,
  DescribeTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CreateCollectionCommand,
  DeleteCollectionCommand,
  DescribeCollectionCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  ephemeralCollectionId,
  requireEphemeralCollectionNamespace,
} from './lib/ephemeralCollections.mjs';

const resourcePrefix = requireEphemeralCollectionNamespace();
const tableName = process.env.EPHEMERAL_DYNAMODB_TABLE_NAME;
const bucketName = process.env.EPHEMERAL_UPLOADS_BUCKET_NAME;
const functionName = process.env.EPHEMERAL_RETENTION_FUNCTION_NAME;
assert(
  tableName && bucketName && functionName,
  'PR stack outputs are required.',
);
assert.equal(functionName, `${resourcePrefix}-retention-purger`);
assert.equal(tableName, resourcePrefix);
assert(bucketName.startsWith(`${resourcePrefix}-`));

const region = process.env.AWS_REGION ?? 'eu-west-1';
const dynamoClient = new DynamoDBClient({ region });
const dynamo = DynamoDBDocumentClient.from(dynamoClient);
const s3 = new S3Client({ region });
const rekognition = new RekognitionClient({ region });
const fixtureKeys = [];
const objectKeys = [];
const collections = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scheduler(command, input) {
  const args = ['scheduler', command, '--region', region];
  if (command === 'get-schedule') args.push('--name', functionName);
  else args.push('--cli-input-json', JSON.stringify(input));
  return JSON.parse(
    execFileSync('aws', args, { encoding: 'utf8', timeout: 30000 }),
  );
}

function updateInput(schedule, expression) {
  const keys = [
    'ActionAfterCompletion',
    'Description',
    'EndDate',
    'FlexibleTimeWindow',
    'GroupName',
    'KmsKeyArn',
    'ScheduleExpressionTimezone',
    'StartDate',
    'State',
    'Target',
  ];
  return {
    Name: functionName,
    ScheduleExpression: expression,
    ...Object.fromEntries(
      keys
        .filter((key) => schedule[key] != null)
        .map((key) => [key, schedule[key]]),
    ),
  };
}

async function put(item) {
  fixtureKeys.push({ PK: item.PK, SK: item.SK });
  await dynamo.send(new PutCommand({ TableName: tableName, Item: item }));
}

async function get(key) {
  return (
    await dynamo.send(
      new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }),
    )
  ).Item;
}

async function objectExists(key) {
  const result = await s3.send(
    new ListObjectsV2Command({ Bucket: bucketName, Prefix: key, MaxKeys: 1 }),
  );
  return Boolean(result.Contents?.some((object) => object.Key === key));
}

async function collectionExists(collectionId) {
  try {
    await rekognition.send(
      new DescribeCollectionCommand({ CollectionId: collectionId }),
    );
    return true;
  } catch (error) {
    if (error?.name === 'ResourceNotFoundException') return false;
    throw error;
  }
}

async function seedEvent(expired) {
  const eventId = `evt-scheduler-${randomUUID()}`;
  const eventKey = { PK: `EVENT#${eventId}`, SK: 'METADATA' };
  const objectKey = `events/${eventId}/photos/synthetic-scheduler.jpg`;
  const collectionId = ephemeralCollectionId(eventId);
  const now = new Date();
  const listingKey = `${now.toISOString()}#${eventId}`;
  await put({
    ...eventKey,
    eventId,
    name: 'Synthetic Scheduler acceptance',
    date: now.toISOString(),
    createdAt: new Date(
      now.getTime() - (expired ? 3 : 0) * 86400000,
    ).toISOString(),
    retentionDays: 1,
    status: 'OPEN',
    GSI2PK: 'ENTITY#EVENT',
    GSI2SK: listingKey,
  });
  objectKeys.push(objectKey);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      ContentType: 'image/jpeg',
      Body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    }),
  );
  collections.push(collectionId);
  await rekognition.send(
    new CreateCollectionCommand({
      CollectionId: collectionId,
      Tags: {
        Project: 'findly',
        Environment: resourcePrefix.slice('findly-'.length),
        ManagedBy: 'CI',
        CostCenter: 'findly-ci',
        DataClass: 'synthetic',
        Ephemeral: 'true',
        PullRequest: resourcePrefix.slice('findly-pr-'.length),
      },
    }),
  );
  return { eventId, eventKey, objectKey, collectionId, listingKey };
}

async function waitForGsi(fixture) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const result = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :events AND GSI2SK = :listing',
        ExpressionAttributeValues: {
          ':events': 'ENTITY#EVENT',
          ':listing': fixture.listingKey,
        },
        ProjectionExpression: 'eventId',
      }),
    );
    if (result.Items?.some((item) => item.eventId === fixture.eventId)) return;
    await pause(1000);
  }
  throw new Error('Synthetic expired event was not visible in GSI2.');
}

async function waitForScheduledPurge(fixture) {
  const startedAt = Date.now();
  const deadline = startedAt + 4 * 60000;
  let nextProgressAt = startedAt;
  while (Date.now() < deadline) {
    if (!(await get(fixture.eventKey))) {
      assert.equal(await objectExists(fixture.objectKey), false);
      assert.equal(await collectionExists(fixture.collectionId), false);
      return;
    }
    if (Date.now() >= nextProgressAt) {
      console.log(
        `Scheduler progress: waiting for the expired synthetic event to be purged; ${Math.floor((Date.now() - startedAt) / 1000)}s elapsed (limit: 240s).`,
      );
      nextProgressAt = Date.now() + 30000;
    }
    await pause(5000);
  }
  throw new Error(
    'Scheduler did not purge the expired synthetic event in four minutes.',
  );
}

async function cleanupFixtures() {
  const failures = [];
  for (const key of objectKeys) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
    } catch (error) {
      failures.push(error);
    }
  }
  for (const collectionId of collections) {
    try {
      await rekognition.send(
        new DeleteCollectionCommand({ CollectionId: collectionId }),
      );
    } catch (error) {
      if (error?.name !== 'ResourceNotFoundException') failures.push(error);
    }
  }
  for (const key of fixtureKeys) {
    try {
      await dynamo.send(new DeleteCommand({ TableName: tableName, Key: key }));
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

let originalSchedule;
let scheduleChanged = false;
let primaryError;
const cleanupFailures = [];
try {
  console.log(
    'Scheduler acceptance: verifying DynamoDB TTL and the deployed schedule.',
  );
  const ttl = await dynamoClient.send(
    new DescribeTimeToLiveCommand({ TableName: tableName }),
  );
  assert.equal(ttl.TimeToLiveDescription?.TimeToLiveStatus, 'ENABLED');
  assert.equal(ttl.TimeToLiveDescription?.AttributeName, 'ttl');

  originalSchedule = scheduler('get-schedule');
  assert.equal(originalSchedule.Name, functionName);
  assert.equal(originalSchedule.ScheduleExpression, 'cron(0 3 * * ? *)');
  assert.equal(originalSchedule.State, 'ENABLED');
  assert.equal(originalSchedule.FlexibleTimeWindow?.Mode, 'OFF');
  assert(
    originalSchedule.Target?.Arn.endsWith(`:function:${functionName}`),
    'Scheduler target must be the PR retention Lambda.',
  );

  scheduleChanged = true;
  scheduler('update-schedule', {
    ...updateInput(originalSchedule, originalSchedule.ScheduleExpression),
    State: 'DISABLED',
  });
  const expired = await seedEvent(true);
  const active = await seedEvent(false);
  await waitForGsi(expired);
  scheduler('update-schedule', {
    ...updateInput(originalSchedule, 'rate(1 minute)'),
    State: 'ENABLED',
  });
  assert.equal(scheduler('get-schedule').ScheduleExpression, 'rate(1 minute)');
  console.log(
    'Scheduler acceptance: one-minute schedule enabled for synthetic fixtures; waiting for the retention Lambda.',
  );
  await waitForScheduledPurge(expired);
  assert(await get(active.eventKey), 'Active synthetic event was removed.');
  assert.equal(await objectExists(active.objectKey), true);
  assert.equal(await collectionExists(active.collectionId), true);
  console.log(
    'EventBridge Scheduler invoked the PR retention Lambda and purged the expired synthetic event; active data survived. DynamoDB TTL is enabled on ttl. Service-side TTL deletion was not observed.',
  );
} catch (error) {
  primaryError = error;
} finally {
  if (scheduleChanged) {
    console.log(
      'Scheduler acceptance: restoring the original schedule and removing synthetic fixtures.',
    );
    try {
      scheduler(
        'update-schedule',
        updateInput(originalSchedule, originalSchedule.ScheduleExpression),
      );
      assert.equal(
        scheduler('get-schedule').ScheduleExpression,
        originalSchedule.ScheduleExpression,
      );
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  cleanupFailures.push(...(await cleanupFixtures()));
}
if (primaryError || cleanupFailures.length)
  throw new AggregateError(
    [primaryError, ...cleanupFailures].filter(Boolean),
    'Scheduler acceptance or synthetic cleanup failed.',
  );
