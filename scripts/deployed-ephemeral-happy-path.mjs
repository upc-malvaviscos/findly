import { createHash, randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const apiEndpoint = process.env.EPHEMERAL_API_ENDPOINT?.replace(/\/$/, '');
const idToken = process.env.EPHEMERAL_ID_TOKEN;
const tableName = process.env.EPHEMERAL_DYNAMODB_TABLE_NAME;
const uploadsBucket = process.env.EPHEMERAL_UPLOADS_BUCKET_NAME;
if (!apiEndpoint || !idToken || !tableName || !uploadsBucket)
  throw new Error(
    'The deployed happy path requires API, token, table, and bucket outputs.',
  );
const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION }),
);
const s3 = new S3Client({ region: process.env.AWS_REGION });
const hash = (value) => createHash('sha256').update(value).digest('hex');

async function admin(path, init = {}) {
  const response = await fetch(`${apiEndpoint}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${idToken}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  if (!response.ok)
    throw new Error(`Deployed API ${path} returned ${response.status}.`);
  return response.json();
}
async function gallery(token, expectedStatus) {
  const response = await fetch(
    `${apiEndpoint}/gallery?token=${encodeURIComponent(token)}`,
  );
  if (response.status !== expectedStatus)
    throw new Error(
      `Gallery returned ${response.status}, expected ${expectedStatus}.`,
    );
  return response.json();
}

const initialEvents = await admin('/admin/events');
if (!Array.isArray(initialEvents.events))
  throw new Error('The deployed event listing did not return an events array.');
const created = await admin('/admin/events', {
  method: 'POST',
  body: JSON.stringify({
    name: `CI ephemeral event ${process.env.GITHUB_RUN_ID ?? 'local'}`,
    date: '2030-01-01T12:00:00.000Z',
    retentionDays: 1,
  }),
});
if (typeof created.eventId !== 'string' || !created.eventId.startsWith('evt-'))
  throw new Error('The deployed API did not return an event identifier.');
const selectedEvents = await admin('/admin/events');
if (!selectedEvents.events.some((event) => event.eventId === created.eventId))
  throw new Error(
    'The created event cannot be selected from the deployed listing.',
  );
const uploadRequest = await admin(
  `/admin/events/${encodeURIComponent(created.eventId)}/photos/uploads`,
  {
    method: 'POST',
    body: JSON.stringify({
      files: [
        { fileName: 'synthetic-ci-photo.jpg', contentType: 'image/jpeg' },
      ],
    }),
  },
);
const uploadUrl = uploadRequest.uploads?.[0]?.uploadUrl;
if (typeof uploadUrl !== 'string')
  throw new Error(
    'The deployed API did not return a presigned JPEG upload URL.',
  );
const upload = await fetch(uploadUrl, {
  method: 'PUT',
  headers: { 'content-type': 'image/jpeg' },
  body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
});
if (!upload.ok)
  throw new Error(`The deployed S3 upload returned ${upload.status}.`);

const eventId = `evt-gallery-${randomUUID()}`;
const photoId = randomUUID();
const registrationId = `reg-${randomUUID()}`;
const validToken = randomUUID();
const emptyToken = randomUUID();
const expiredToken = randomUUID();
const photoKey = `events/${eventId}/photos/${photoId}.jpg`;
const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const put = (Item) =>
  dynamo.send(new PutCommand({ TableName: tableName, Item }));
await put({
  PK: `EVENT#${eventId}`,
  SK: 'METADATA',
  eventId,
  name: 'Synthetic CI Gallery',
  retentionDays: 1,
  createdAt: new Date().toISOString(),
  status: 'OPEN',
});
await put({
  PK: `TOKEN#${hash(validToken)}`,
  SK: 'METADATA',
  registrationId,
  eventId,
  expiresAt,
});
await put({
  PK: `TOKEN#${hash(emptyToken)}`,
  SK: 'METADATA',
  registrationId: `reg-empty-${randomUUID()}`,
  eventId,
  expiresAt,
});
await put({
  PK: `TOKEN#${hash(expiredToken)}`,
  SK: 'METADATA',
  registrationId: `reg-expired-${randomUUID()}`,
  eventId,
  expiresAt: '2020-01-01T00:00:00.000Z',
});
await put({
  PK: `REG#${registrationId}`,
  SK: `MATCH#${photoId}`,
  photoId,
  eventId,
  matchedAt: new Date().toISOString(),
});
await put({
  PK: `EVENT#${eventId}`,
  SK: `PHOTO#${photoId}`,
  photoId,
  eventId,
  s3Key: photoKey,
  uploadedAt: new Date().toISOString(),
});
await s3.send(
  new PutObjectCommand({
    Bucket: uploadsBucket,
    Key: photoKey,
    Body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    ContentType: 'image/jpeg',
  }),
);

const valid = await gallery(validToken, 200);
if (
  valid.eventId !== eventId ||
  valid.eventName !== 'Synthetic CI Gallery' ||
  valid.photos?.length !== 1 ||
  valid.photos[0]?.photoId !== photoId ||
  typeof valid.photos[0]?.url !== 'string'
)
  throw new Error(
    'The deployed gallery response did not contain the seeded metadata.',
  );
const image = await fetch(valid.photos[0].url);
if (!image.ok || !image.headers.get('content-type')?.startsWith('image/jpeg'))
  throw new Error(
    'The deployed gallery presigned URL did not return the synthetic JPEG.',
  );
const missing = await gallery(randomUUID(), 404);
if (missing.code !== 'GALLERY_NOT_FOUND')
  throw new Error('Unknown gallery tokens must return GALLERY_NOT_FOUND.');
const expired = await gallery(expiredToken, 410);
if (expired.code !== 'GALLERY_EXPIRED')
  throw new Error('Expired gallery tokens must return GALLERY_EXPIRED.');
const empty = await gallery(emptyToken, 200);
if (!Array.isArray(empty.photos) || empty.photos.length !== 0)
  throw new Error('A valid empty gallery must return an empty photos array.');
console.log(
  'Deployed AWS organizer and seeded-gallery happy paths passed with synthetic data.',
);
