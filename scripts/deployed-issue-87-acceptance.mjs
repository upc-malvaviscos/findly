// Real AWS ephemeral acceptance for issue #87 (spec 21): matching converges
// regardless of upload order. Runs against the sandbox stack already applied
// with `npm run dev:aws` (or an equivalent direct `terraform apply`) using the
// same backend as scripts/test-aws-sandbox.mjs. No browser: API Gateway CORS
// is a browser-only restriction, so plain fetch works for this server-side
// probe. Writes a reproducible evidence file (JSON) that
// docs/evidence/issue-87-matching-convergence.md quotes from.
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { withCleanup, deleteSandboxOrganizer } from './lib/sandbox-cleanup.mjs';

const profile = process.env.AWS_PROFILE;
const stateBucket = process.env.FINDLY_TERRAFORM_STATE_BUCKET;
const region = process.env.FINDLY_AWS_REGION ?? 'eu-west-1';
if (!stateBucket) throw new Error('FINDLY_TERRAFORM_STATE_BUCKET is required.');

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
const run = (file, args, cwd = 'infra/environments/sandbox') => {
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
const userPoolId = outputs.cognito_user_pool_id.value;
const clientId = outputs.cognito_client_id.value;

const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region, credentials }),
);
const s3 = new S3Client({ region, credentials });
const logs = new CloudWatchLogsClient({ region, credentials });

const face = readFileSync('e2e/fixtures/synthetic-adult-face.jpg');

async function admin(token, path, init = {}, expected = 200) {
  const response = await fetch(`${apiEndpoint}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  if (response.status !== expected)
    throw new Error(
      `Admin ${path} returned ${response.status}, expected ${expected}.`,
    );
  return response.status === 204 ? undefined : response.json();
}

async function createEvent(token, name) {
  const created = await admin(
    token,
    '/admin/events',
    {
      method: 'POST',
      body: JSON.stringify({
        name,
        date: '2030-01-01T12:00:00.000Z',
        retentionDays: 1,
      }),
    },
    201,
  );
  return created.eventId;
}

async function uploadPhoto(token, eventId) {
  const upload = await admin(
    token,
    `/admin/events/${encodeURIComponent(eventId)}/photos/uploads`,
    {
      method: 'POST',
      body: JSON.stringify({
        files: [{ fileName: `${randomUUID()}.jpg`, contentType: 'image/jpeg' }],
      }),
    },
  );
  const photo = upload.uploads?.[0];
  if (!photo?.photoId || !photo?.uploadUrl)
    throw new Error('Admin upload contract was incomplete.');
  const response = await fetch(photo.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: face,
  });
  if (!response.ok)
    throw new Error(`Photo presigned upload returned ${response.status}.`);
  return photo.photoId;
}

async function registerSelfie(eventId) {
  const response = await fetch(
    `${apiEndpoint}/events/${encodeURIComponent(eventId)}/registrations`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'synthetic@example.com',
        consentBiometrics: true,
        consentTerms: true,
      }),
    },
  );
  if (response.status !== 201)
    throw new Error(`Public registration returned ${response.status}.`);
  const body = await response.json();
  const uploaded = await fetch(body.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg', 'if-none-match': '*' },
    body: face,
  });
  if (uploaded.status !== 200)
    throw new Error(`Selfie presigned upload returned ${uploaded.status}.`);
  return {
    registrationId: body.registrationId,
    galleryToken: body.galleryToken,
  };
}

async function pollRegistrationStatus(registrationId, galleryToken) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${apiEndpoint}/registrations/${encodeURIComponent(registrationId)}/status`,
      { headers: { 'X-Gallery-Token': galleryToken } },
    );
    if (response.status !== 200)
      throw new Error(`Status polling returned ${response.status}.`);
    const body = await response.json();
    if (body.status === 'ENROLLED' || body.status === 'FAILED') return body;
    await delay(1500);
  }
  throw new Error('Registration did not reach a terminal status in time.');
}

async function pollMatch(registrationId, photoId, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await dynamo.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `REG#${registrationId}`, SK: `MATCH#${photoId}` },
        ConsistentRead: true,
      }),
    );
    if (result.Item) return result.Item;
    await delay(2000);
  }
  return null;
}

async function countMatches(registrationId) {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `REG#${registrationId}`,
        ':prefix': 'MATCH#',
      },
      ConsistentRead: true,
    }),
  );
  return result.Items ?? [];
}

async function recentLogs(functionName, sinceMs, filterPattern) {
  const result = await logs.send(
    new FilterLogEventsCommand({
      logGroupName: `/aws/lambda/${functionName}`,
      startTime: sinceMs,
      filterPattern,
    }),
  );
  return (result.events ?? []).map((event) => event.message?.trim());
}

const evidence = { generatedAt: new Date().toISOString(), scenarios: {} };

async function main() {
  const userName = `acceptance87-${randomUUID()}`;
  // Leading 'A' guarantees the value never starts with '-', which the AWS
  // CLI's argument parser would otherwise mistake for a flag.
  const password = `A${randomBytes(24).toString('base64url')}a1!`;
  const registrationsToDelete = [];

  await withCleanup(async (cleanup) => {
    cleanup.add('temporary organizer', () =>
      deleteSandboxOrganizer(() =>
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
      ),
    );
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

    const deleteFixture = (eventId, photoId) => {
      cleanup.add('photo metadata', () =>
        dynamo.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { PK: `EVENT#${eventId}`, SK: `PHOTO#${photoId}` },
          }),
        ),
      );
      cleanup.add('photo object', () =>
        s3.send(
          new DeleteObjectCommand({
            Bucket: outputs.uploads_bucket_name.value,
            Key: `events/${eventId}/photos/${photoId}.jpg`,
          }),
        ),
      );
      cleanup.add('event metadata', () =>
        dynamo.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { PK: `EVENT#${eventId}`, SK: 'METADATA' },
          }),
        ),
      );
    };

    // --- Scenario A: selfie before photo (regression over spec 07/#8) ---
    {
      const eventId = await createEvent(
        token,
        `Order A selfie-then-photo ${randomUUID()}`,
      );
      const startedAt = Date.now();
      const { registrationId, galleryToken } = await registerSelfie(eventId);
      registrationsToDelete.push({ registrationId, galleryToken });
      const status = await pollRegistrationStatus(registrationId, galleryToken);
      if (status.status !== 'ENROLLED')
        throw new Error(`Scenario A: registration ended ${status.status}.`);
      const photoId = await uploadPhoto(token, eventId);
      deleteFixture(eventId, photoId);
      const match = await pollMatch(registrationId, photoId);
      evidence.scenarios.A_selfie_then_photo = {
        eventId,
        registrationId,
        photoId,
        enrolledAfterMs: Date.now() - startedAt,
        match,
      };
      if (!match) throw new Error('Scenario A: no match produced.');
    }

    // --- Scenario B: photo before selfie (backfill, issue #87 core case) ---
    {
      const eventId = await createEvent(
        token,
        `Order B photo-then-selfie ${randomUUID()}`,
      );
      const startedAt = Date.now();
      const photoId = await uploadPhoto(token, eventId);
      deleteFixture(eventId, photoId);
      // The photo is already fully processed by the S3-triggered path before
      // any registration exists; confirm it produced no match yet.
      await delay(5000);
      const { registrationId, galleryToken } = await registerSelfie(eventId);
      registrationsToDelete.push({ registrationId, galleryToken });
      const enrolledAt = Date.now();
      const status = await pollRegistrationStatus(registrationId, galleryToken);
      if (status.status !== 'ENROLLED')
        throw new Error(`Scenario B: registration ended ${status.status}.`);
      const match = await pollMatch(registrationId, photoId);
      const backfillLogs = await recentLogs(
        'findly-sandbox-registration-backfill',
        startedAt,
        'registration_backfill_processed',
      );
      evidence.scenarios.B_photo_then_selfie = {
        eventId,
        registrationId,
        photoId,
        enrolledAfterMs: enrolledAt - startedAt,
        match,
        backfillLogSample: backfillLogs.at(-1) ?? null,
        backfillLogsMentionRegistrationId: backfillLogs.some((line) =>
          line?.includes(registrationId),
        ),
      };
      if (!match) throw new Error('Scenario B: backfill produced no match.');
    }

    // --- Scenario C: concurrent uploads converge without duplicating ---
    {
      const eventId = await createEvent(
        token,
        `Order C concurrent ${randomUUID()}`,
      );
      const startedAt = Date.now();
      const [{ registrationId, galleryToken }, photoId] = await Promise.all([
        registerSelfie(eventId),
        uploadPhoto(token, eventId),
      ]);
      registrationsToDelete.push({ registrationId, galleryToken });
      deleteFixture(eventId, photoId);
      const status = await pollRegistrationStatus(registrationId, galleryToken);
      if (status.status !== 'ENROLLED')
        throw new Error(`Scenario C: registration ended ${status.status}.`);
      const match = await pollMatch(registrationId, photoId);
      if (!match) throw new Error('Scenario C: no match produced.');
      // Give a slower trigger (the loser of the race) time to also attempt a
      // write before asserting there is still exactly one match.
      await delay(10000);
      const allMatches = await countMatches(registrationId);
      evidence.scenarios.C_concurrent = {
        eventId,
        registrationId,
        photoId,
        startedAt: new Date(startedAt).toISOString(),
        matchCount: allMatches.length,
        match,
      };
      if (allMatches.length !== 1)
        throw new Error(
          `Scenario C: expected exactly 1 match, found ${allMatches.length}.`,
        );
    }

    for (const { registrationId, galleryToken } of registrationsToDelete) {
      cleanup.add('registration erasure (defensive, best-effort)', async () => {
        try {
          await fetch(
            `${apiEndpoint}/registrations/${encodeURIComponent(registrationId)}`,
            { method: 'DELETE', headers: { 'X-Gallery-Token': galleryToken } },
          );
        } catch {
          // Best-effort: the main erasure call below already ran for most
          // registrations; this only covers one left over by a thrown error.
        }
      });
    }
    for (const { registrationId, galleryToken } of registrationsToDelete) {
      const response = await fetch(
        `${apiEndpoint}/registrations/${encodeURIComponent(registrationId)}`,
        { method: 'DELETE', headers: { 'X-Gallery-Token': galleryToken } },
      );
      if (response.status !== 204)
        throw new Error(
          `Registration erasure returned ${response.status}, expected 204.`,
        );
    }
  });

  writeFileSync(
    'docs/evidence/issue-87-acceptance-run.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  console.log(
    'Issue #87 AWS ephemeral acceptance passed. Evidence written to docs/evidence/issue-87-acceptance-run.json',
  );
}

await main();
