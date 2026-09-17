import { createHash } from 'node:crypto';
import {
  CreateTableCommand,
  DynamoDBClient,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  S3Client,
  CreateBucketCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

const endpoint = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566';
const region = 'eu-west-1';
const tableName = process.env.FINDLY_TABLE_NAME ?? 'findly-local';
const bucket = process.env.FINDLY_PHOTO_BUCKET ?? 'findly-local-photos';
const token = process.env.FINDLY_DEMO_TOKEN ?? 'demo-gallery';
const webPort = process.env.WEB_PORT ?? '4173';
const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const ddb = new DynamoDBClient({ endpoint, region });
const s3 = new S3Client({ endpoint, region, forcePathStyle: true });
const hash = createHash('sha256').update(token).digest('hex');

try {
  await ddb.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI2PK', AttributeType: 'S' },
        { AttributeName: 'GSI2SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI2',
          KeySchema: [
            { AttributeName: 'GSI2PK', KeyType: 'HASH' },
            { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
} catch (error) {
  if (error.name !== 'ResourceInUseException') throw error;
}
try {
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
} catch (error) {
  if (
    error.name !== 'BucketAlreadyOwnedByYou' &&
    error.name !== 'BucketAlreadyExists'
  )
    throw error;
}
await s3.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedHeaders: ['content-type'],
          AllowedMethods: ['PUT'],
          AllowedOrigins: [`http://127.0.0.1:${webPort}`],
          MaxAgeSeconds: 300,
        },
      ],
    },
  }),
);
await new Promise((resolve) => setTimeout(resolve, 500));
await ddb.send(
  new PutItemCommand({
    TableName: tableName,
    Item: {
      PK: { S: 'EVENT#demo-2026' },
      SK: { S: 'METADATA' },
      name: { S: 'Findly Demo Night' },
    },
  }),
);
await ddb.send(
  new PutItemCommand({
    TableName: tableName,
    Item: {
      PK: {
        S: `TOKEN#${createHash('sha256').update('demo-gallery-empty').digest('hex')}`,
      },
      SK: { S: 'METADATA' },
      registrationId: { S: 'registration-empty' },
      eventId: { S: 'demo-2026' },
      expiresAt: { S: expiresAt },
    },
  }),
);
await ddb.send(
  new PutItemCommand({
    TableName: tableName,
    Item: {
      PK: {
        S: `TOKEN#${createHash('sha256').update('expired').digest('hex')}`,
      },
      SK: { S: 'METADATA' },
      registrationId: { S: 'registration-expired' },
      eventId: { S: 'demo-2026' },
      expiresAt: { S: '2020-01-01T00:00:00.000Z' },
    },
  }),
);

await ddb.send(
  new PutItemCommand({
    TableName: tableName,
    Item: {
      PK: { S: `TOKEN#${hash}` },
      SK: { S: 'METADATA' },
      registrationId: { S: 'registration-demo' },
      eventId: { S: 'demo-2026' },
      expiresAt: { S: expiresAt },
    },
  }),
);
for (const photoId of ['photo-1', 'photo-2']) {
  await ddb.send(
    new PutItemCommand({
      TableName: tableName,
      Item: {
        PK: { S: 'REG#registration-demo' },
        SK: { S: `MATCH#${photoId}` },
        photoId: { S: photoId },
        eventId: { S: 'demo-2026' },
        matchedAt: { S: new Date().toISOString() },
      },
    }),
  );
  await ddb.send(
    new PutItemCommand({
      TableName: tableName,
      Item: {
        PK: { S: 'EVENT#demo-2026' },
        SK: { S: `PHOTO#${photoId}` },
        s3Key: { S: `events/demo-2026/photos/${photoId}.jpg` },
      },
    }),
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `events/demo-2026/photos/${photoId}.jpg`,
      Body: Buffer.from(`local-${photoId}`),
      ContentType: 'image/jpeg',
    }),
  );
}
console.log(`Seeded local gallery token ${token.slice(0, 4)}…`);
