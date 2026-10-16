// Real AWS ephemeral benchmark for issue #49 (section 7 of
// docs/evidence/issue-49-dynamodb-vs-rds-analysis.md): the synthetic
// fan-out/convergence evidence that keeps #49 open after ADR-022 decided
// DynamoDB and the photo->match mirror item (already implemented in
// src/lambdas/lib/matching.ts and consumed by adminEvents.deleteEventPhoto).
// Runs against the sandbox stack already applied with `npm run dev:aws` (or
// an equivalent direct `terraform apply`), same backend as
// scripts/deployed-issue-87-acceptance.mjs. Writes a reproducible evidence
// file (JSON) that docs/evidence/issue-49-dynamodb-vs-rds-analysis.md quotes
// from.
//
// Scenario A (fan-out at scale): seeds match+mirror item pairs directly in
// DynamoDB for one photo -- not through Rekognition, which would be
// prohibitively expensive and slow for hundreds/thousands of distinct
// synthetic faces -- then calls the real admin delete-photo endpoint and
// measures requests/latency, confirming zero orphans (neither the match nor
// its mirror survive). Scenario B (deletion-during-matching race): a real
// enrolled selfie and a real photo upload (so the match is produced by the
// actual Rekognition pipeline, not seeded) racing against a concurrent
// admin delete of that same photo, reporting whatever outcome AWS actually
// produces instead of assuming the mirror item alone prevents a resurrected
// match.
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
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

async function queryCount(partitionKeyValue) {
  let exclusiveStartKey;
  let count = 0;
  do {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': partitionKeyValue },
        ConsistentRead: true,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    count += page.Items?.length ?? 0;
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return count;
}

async function getItem(key) {
  const result = await dynamo.send(
    new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }),
  );
  return result.Item ?? null;
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

// Seeds N synthetic match+mirror pairs for one photo directly in DynamoDB --
// not through Rekognition -- so the fan-out scale test exercises the real
// deleteEventPhoto cleanup loop without N real enrollments/Rekognition
// calls. registrationIds are random UUIDs with no backing registration;
// deleteEventPhoto's query only reads the mirror item's registrationId
// attribute, it never re-validates the registration exists.
async function seedFanOut(eventId, photoId, count) {
  const registrationIds = Array.from({ length: count }, () => randomUUID());
  const ttl = Math.floor(Date.now() / 1000) + 3600;
  // BatchWriteCommand allows at most 25 requests per call; each
  // registrationId contributes 2 (match + mirror), so chunk by 12 to stay
  // under that limit (24 requests per batch).
  const chunks = [];
  for (let i = 0; i < registrationIds.length; i += 12)
    chunks.push(registrationIds.slice(i, i + 12));
  for (const chunk of chunks) {
    let requests = chunk.flatMap((registrationId) => {
      const match = {
        matchId: randomUUID(),
        eventId,
        registrationId,
        photoId,
        similarity: 100,
        matchedAt: new Date().toISOString(),
        ttl,
      };
      return [
        {
          PutRequest: {
            Item: {
              PK: `REG#${registrationId}`,
              SK: `MATCH#${photoId}`,
              ...match,
            },
          },
        },
        {
          PutRequest: {
            Item: {
              PK: `PHOTO#${eventId}#${photoId}`,
              SK: `MATCH#${registrationId}`,
              ...match,
            },
          },
        },
      ];
    });
    // Retry any capacity-throttled UnprocessedItems instead of silently
    // under-seeding the benchmark's "before" count.
    for (let attempt = 0; requests.length > 0 && attempt < 5; attempt++) {
      const result = await dynamo.send(
        new BatchWriteCommand({ RequestItems: { [tableName]: requests } }),
      );
      requests = result.UnprocessedItems?.[tableName] ?? [];
      if (requests.length > 0) await delay(500 * (attempt + 1));
    }
    if (requests.length > 0)
      throw new Error(
        `seedFanOut: ${requests.length} items still unprocessed after retries.`,
      );
  }
  return registrationIds;
}

const evidence = { generatedAt: new Date().toISOString(), scenarios: {} };

async function main() {
  const userName = `benchmark49-${randomUUID()}`;
  const password = `A${randomBytes(24).toString('base64url')}a1!`;

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

    const eventsToDelete = [];
    const registrationsToDelete = [];
    const failures = [];

    // --- Scenario A: fan-out at scale, seeded matches, real deletion ---
    // Each size runs in its own try/catch: a 3s Lambda timeout at the
    // larger size (infra/modules/admin-api/main.tf gives delete_photo only
    // 3s, unlike delete_event's 60s) is itself the kind of evidence this
    // benchmark exists to surface, not a reason to lose the smaller size's
    // result or abort before scenario B runs.
    for (const matchCount of [100, 1000]) {
      const key = `A_fanout_${matchCount}`;
      try {
        const eventId = await createEvent(
          token,
          `Issue49 fanout-${matchCount} ${randomUUID()}`,
        );
        eventsToDelete.push(eventId);
        const photoId = await uploadPhoto(token, eventId);
        const registrationIds = await seedFanOut(eventId, photoId, matchCount);

        const before = await queryCount(`PHOTO#${eventId}#${photoId}`);
        const startedAt = Date.now();
        const response = await fetch(
          `${apiEndpoint}/admin/events/${encodeURIComponent(eventId)}/photos/${encodeURIComponent(photoId)}`,
          { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
        );
        const latencyMs = Date.now() - startedAt;

        const mirrorAfter = await queryCount(`PHOTO#${eventId}#${photoId}`);
        const sample = registrationIds.slice(0, 5);
        const survivingSample = [];
        for (const registrationId of sample) {
          const item = await getItem({
            PK: `REG#${registrationId}`,
            SK: `MATCH#${photoId}`,
          });
          if (item) survivingSample.push(registrationId);
        }
        const photoItem = await getItem({
          PK: `EVENT#${eventId}`,
          SK: `PHOTO#${photoId}`,
        });

        evidence.scenarios[key] = {
          eventId,
          photoId,
          matchCount,
          deleteResponseStatus: response.status,
          mirrorItemsBeforeDelete: before,
          mirrorItemsAfterDelete: mirrorAfter,
          sampledMatchKeysSurviving: survivingSample.length,
          photoItemSurvives: Boolean(photoItem),
          deleteLatencyMs: latencyMs,
        };
        if (before !== matchCount)
          throw new Error(
            `seeded ${before} mirror items, expected ${matchCount}`,
          );
        if (response.status !== 204)
          throw new Error(`delete returned ${response.status}`);
        if (mirrorAfter !== 0)
          throw new Error(`${mirrorAfter} mirror items survived deletion`);
        if (survivingSample.length !== 0)
          throw new Error(
            `${survivingSample.length} sampled match keys survived`,
          );
        if (photoItem) throw new Error('the photo item survived');
      } catch (caught) {
        failures.push(`Scenario A (${matchCount}): ${caught.message}`);
        evidence.scenarios[key] = {
          ...(evidence.scenarios[key] ?? {}),
          error: caught.message,
        };
      }
    }

    // --- Scenario B: real deletion racing a real in-flight match write ---
    try {
      const eventId = await createEvent(
        token,
        `Issue49 delete-race ${randomUUID()}`,
      );
      eventsToDelete.push(eventId);
      const { registrationId, galleryToken } = await registerSelfie(eventId);
      registrationsToDelete.push({ registrationId, galleryToken });
      const status = await pollRegistrationStatus(registrationId, galleryToken);
      if (status.status !== 'ENROLLED')
        throw new Error(`Scenario B: registration ended ${status.status}.`);

      const upload = await admin(
        token,
        `/admin/events/${encodeURIComponent(eventId)}/photos/uploads`,
        {
          method: 'POST',
          body: JSON.stringify({
            files: [
              { fileName: `${randomUUID()}.jpg`, contentType: 'image/jpeg' },
            ],
          }),
        },
      );
      const photo = upload.uploads?.[0];
      if (!photo?.photoId || !photo?.uploadUrl)
        throw new Error('Scenario B: admin upload contract was incomplete.');
      const startedAt = Date.now();

      const [uploadResponse, deleteResponse] = await Promise.all([
        fetch(photo.uploadUrl, {
          method: 'PUT',
          headers: { 'content-type': 'image/jpeg' },
          body: face,
        }),
        fetch(
          `${apiEndpoint}/admin/events/${encodeURIComponent(eventId)}/photos/${encodeURIComponent(photo.photoId)}`,
          { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
        ),
      ]);
      if (!uploadResponse.ok)
        throw new Error(
          `Scenario B: photo upload returned ${uploadResponse.status}.`,
        );
      // The delete may race the photo's own creation and return 404 if it
      // runs before the object/metadata exist; both outcomes are valid
      // races, report which one actually happened.
      const deleteOutcome = deleteResponse.status;

      // Give the real S3-triggered photoMatcher (and, if the delete lost
      // the race, a resurrected match) time to settle.
      await delay(20000);

      const matchAfter = await getItem(
        matchKeyFor(registrationId, photo.photoId),
      );
      const mirrorAfter = await getItem(
        mirrorKeyFor(eventId, photo.photoId, registrationId),
      );
      const photoItemAfter = await getItem({
        PK: `EVENT#${eventId}`,
        SK: `PHOTO#${photo.photoId}`,
      });
      const matcherLogs = await recentLogs(
        'findly-sandbox-photo-matcher',
        startedAt,
        photo.photoId,
      );

      evidence.scenarios.B_delete_during_match_race = {
        eventId,
        registrationId,
        photoId: photo.photoId,
        deleteResponseStatus: deleteOutcome,
        matchSurvived: Boolean(matchAfter),
        mirrorSurvived: Boolean(mirrorAfter),
        photoItemSurvived: Boolean(photoItemAfter),
        photoMatcherLogSample: matcherLogs.at(-1) ?? null,
      };
      if (matchAfter || mirrorAfter)
        throw new Error(
          'a match (or its mirror) survived racing a photo deletion -- see evidence for the exact outcome',
        );
    } catch (caught) {
      failures.push(`Scenario B: ${caught.message}`);
      evidence.scenarios.B_delete_during_match_race = {
        ...(evidence.scenarios.B_delete_during_match_race ?? {}),
        error: caught.message,
      };
    }

    for (const eventId of eventsToDelete) {
      cleanup.add('event metadata', () =>
        dynamo.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { PK: `EVENT#${eventId}`, SK: 'METADATA' },
          }),
        ),
      );
    }
    for (const { registrationId, galleryToken } of registrationsToDelete) {
      try {
        const response = await fetch(
          `${apiEndpoint}/registrations/${encodeURIComponent(registrationId)}`,
          { method: 'DELETE', headers: { 'X-Gallery-Token': galleryToken } },
        );
        if (response.status !== 204)
          throw new Error(`erasure returned ${response.status}, expected 204`);
      } catch (caught) {
        failures.push(
          `Registration cleanup (${registrationId}): ${caught.message}`,
        );
      }
    }

    evidence.failures = failures;
  });

  writeFileSync(
    'docs/evidence/issue-49-fanout-benchmark-run.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  if (evidence.failures?.length) {
    console.log(
      `Issue #49 fan-out benchmark finished with ${evidence.failures.length} failure(s). Evidence written to docs/evidence/issue-49-fanout-benchmark-run.json`,
    );
    for (const failure of evidence.failures) console.log(` - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    'Issue #49 fan-out benchmark passed. Evidence written to docs/evidence/issue-49-fanout-benchmark-run.json',
  );
}

function matchKeyFor(registrationId, photoId) {
  return { PK: `REG#${registrationId}`, SK: `MATCH#${photoId}` };
}
function mirrorKeyFor(eventId, photoId, registrationId) {
  return { PK: `PHOTO#${eventId}#${photoId}`, SK: `MATCH#${registrationId}` };
}

await main();
