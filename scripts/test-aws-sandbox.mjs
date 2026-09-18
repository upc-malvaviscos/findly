import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const profile = process.env.AWS_PROFILE;
const stateBucket = process.env.FINDLY_TERRAFORM_STATE_BUCKET;
const region = process.env.FINDLY_AWS_REGION ?? 'eu-west-1';
if (!stateBucket) throw new Error('FINDLY_TERRAFORM_STATE_BUCKET is required.');
// Use a chosen profile when supplied; otherwise preserve the active AWS
// credential chain, such as a temporary SSO or assumed-role session.
const env = profile
  ? { ...process.env, AWS_PROFILE: profile }
  : { ...process.env };
const exportedCredentials = (() => {
  const result = spawnSync(
    'aws',
    ['configure', 'export-credentials', '--format', 'process'],
    { env, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const credentials = JSON.parse(result.stdout);
  if (!credentials.AccessKeyId || !credentials.SecretAccessKey)
    throw new Error('AWS CLI did not export usable temporary credentials.');
  return credentials;
})();
const awsEnv = {
  ...env,
  AWS_ACCESS_KEY_ID: exportedCredentials.AccessKeyId,
  AWS_SECRET_ACCESS_KEY: exportedCredentials.SecretAccessKey,
  ...(exportedCredentials.SessionToken && {
    AWS_SESSION_TOKEN: exportedCredentials.SessionToken,
  }),
};
const credentials = {
  accessKeyId: exportedCredentials.AccessKeyId,
  secretAccessKey: exportedCredentials.SecretAccessKey,
  ...(exportedCredentials.SessionToken && {
    sessionToken: exportedCredentials.SessionToken,
  }),
};
const run = (file, args, cwd = 'infra') => {
  const result = spawnSync(file, args, { cwd, env: awsEnv, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
};
run('terraform', [
  'init',
  '-input=false',
  `-backend-config=bucket=${stateBucket}`,
  '-backend-config=key=findly/sandbox/terraform.tfstate',
  `-backend-config=region=${region}`,
  '-backend-config=encrypt=true',
  '-backend-config=use_lockfile=true',
]);
const outputs = JSON.parse(run('terraform', ['output', '-json']));
const apiEndpoint = outputs.api_endpoint.value.replace(/\/$/, '');
const tableName = outputs.table_name.value;
const bucket = outputs.uploads_bucket_name.value;
const userPoolId = outputs.cognito_user_pool_id.value;
const clientId = outputs.cognito_client_id.value;
const userName = `smoke-${randomUUID()}`;
const password = `${randomBytes(24).toString('base64url')}Aa1!`;
const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region, credentials }),
);
const s3 = new S3Client({ region, credentials });
const cleanup = [];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const admin = async (token, path, init = {}) => {
  const response = await fetch(`${apiEndpoint}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
  });
  if (!response.ok)
    throw new Error(`AWS API ${path} returned ${response.status}.`);
  return response.json();
};
const gallery = async (token, expected) => {
  const response = await fetch(
    `${apiEndpoint}/gallery?token=${encodeURIComponent(token)}`,
  );
  if (response.status !== expected)
    throw new Error(
      `Gallery returned ${response.status}, expected ${expected}.`,
    );
  return response.json();
};

try {
  run(
    'aws',
    [
      'cognito-idp',
      'admin-create-user',
      '--user-pool-id',
      userPoolId,
      '--username',
      userName,
      '--message-action',
      'SUPPRESS',
    ],
    '.',
  );
  cleanup.push(() =>
    run(
      'aws',
      [
        'cognito-idp',
        'admin-delete-user',
        '--user-pool-id',
        userPoolId,
        '--username',
        userName,
      ],
      '.',
    ),
  );
  run(
    'aws',
    [
      'cognito-idp',
      'admin-set-user-password',
      '--user-pool-id',
      userPoolId,
      '--username',
      userName,
      '--password',
      password,
      '--permanent',
    ],
    '.',
  );
  const token = run(
    'aws',
    [
      'cognito-idp',
      'initiate-auth',
      '--client-id',
      clientId,
      '--auth-flow',
      'USER_PASSWORD_AUTH',
      '--auth-parameters',
      `USERNAME=${userName},PASSWORD=${password}`,
      '--query',
      'AuthenticationResult.IdToken',
      '--output',
      'text',
    ],
    '.',
  );
  if (!token || token === 'None')
    throw new Error('Cognito did not issue an ID token.');
  const unauthorizedAdmin = await fetch(`${apiEndpoint}/admin/events`);
  if (unauthorizedAdmin.status !== 401)
    throw new Error(
      `Unauthenticated admin route returned ${unauthorizedAdmin.status}, expected 401.`,
    );
  const created = await admin(token, '/admin/events', {
    method: 'POST',
    body: JSON.stringify({
      name: `Synthetic smoke ${randomUUID()}`,
      date: '2030-01-01T12:00:00.000Z',
      retentionDays: 1,
    }),
  });
  const eventId = created.eventId;
  const upload = await admin(
    token,
    `/admin/events/${encodeURIComponent(eventId)}/photos/uploads`,
    {
      method: 'POST',
      body: JSON.stringify({
        files: [{ fileName: 'synthetic.jpg', contentType: 'image/jpeg' }],
      }),
    },
  );
  const photo = upload.uploads?.[0];
  if (!eventId || !photo?.photoId || !photo?.uploadUrl)
    throw new Error('Admin upload contract was incomplete.');
  const uploadResponse = await fetch(photo.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  });
  if (!uploadResponse.ok)
    throw new Error(`Presigned upload returned ${uploadResponse.status}.`);
  const adminPhotoKey = `events/${eventId}/photos/${photo.photoId}.jpg`;
  cleanup.push(
    () =>
      dynamo.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { PK: `EVENT#${eventId}`, SK: 'METADATA' },
        }),
      ),
    () =>
      dynamo.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { PK: `EVENT#${eventId}`, SK: `PHOTO#${photo.photoId}` },
        }),
      ),
    () =>
      s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: adminPhotoKey })),
  );
  const galleryEventId = `evt-gallery-${randomUUID()}`;
  const registrationId = `reg-${randomUUID()}`;
  const galleryPhotoId = randomUUID();
  const validToken = randomUUID();
  const emptyToken = randomUUID();
  const expiredToken = randomUUID();
  const galleryKey = `events/${galleryEventId}/photos/${galleryPhotoId}.jpg`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const items = [
    {
      PK: `EVENT#${galleryEventId}`,
      SK: 'METADATA',
      eventId: galleryEventId,
      name: 'Synthetic gallery smoke',
      retentionDays: 1,
      createdAt: new Date().toISOString(),
      status: 'OPEN',
    },
    {
      PK: `TOKEN#${hash(validToken)}`,
      SK: 'METADATA',
      registrationId,
      eventId: galleryEventId,
      expiresAt,
    },
    {
      PK: `TOKEN#${hash(emptyToken)}`,
      SK: 'METADATA',
      registrationId: `reg-empty-${randomUUID()}`,
      eventId: galleryEventId,
      expiresAt,
    },
    {
      PK: `TOKEN#${hash(expiredToken)}`,
      SK: 'METADATA',
      registrationId: `reg-expired-${randomUUID()}`,
      eventId: galleryEventId,
      expiresAt: '2020-01-01T00:00:00.000Z',
    },
    {
      PK: `REG#${registrationId}`,
      SK: `MATCH#${galleryPhotoId}`,
      photoId: galleryPhotoId,
      eventId: galleryEventId,
      matchedAt: new Date().toISOString(),
    },
    {
      PK: `EVENT#${galleryEventId}`,
      SK: `PHOTO#${galleryPhotoId}`,
      photoId: galleryPhotoId,
      eventId: galleryEventId,
      s3Key: galleryKey,
      uploadedAt: new Date().toISOString(),
    },
  ];
  await Promise.all(
    items.map((Item) =>
      dynamo.send(new PutCommand({ TableName: tableName, Item })),
    ),
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: galleryKey,
      Body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      ContentType: 'image/jpeg',
    }),
  );
  cleanup.push(
    ...items.map(
      (item) => () =>
        dynamo.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { PK: item.PK, SK: item.SK },
          }),
        ),
    ),
    () => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: galleryKey })),
  );
  const valid = await gallery(validToken, 200);
  if (valid.eventId !== galleryEventId || valid.photos?.length !== 1)
    throw new Error('Valid gallery contract failed.');
  const image = await fetch(valid.photos[0].url);
  if (!image.ok || !image.headers.get('content-type')?.startsWith('image/jpeg'))
    throw new Error('Gallery photo was not a JPEG.');
  if ((await gallery(randomUUID(), 404)).code !== 'GALLERY_NOT_FOUND')
    throw new Error('Unknown token contract failed.');
  if ((await gallery(expiredToken, 410)).code !== 'GALLERY_EXPIRED')
    throw new Error('Expired token contract failed.');
  if ((await gallery(emptyToken, 200)).photos?.length !== 0)
    throw new Error('Empty gallery contract failed.');
  console.log('AWS sandbox smoke passed with synthetic data.');
} finally {
  await Promise.allSettled(cleanup.reverse().map((task) => task()));
}
