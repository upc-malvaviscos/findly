import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  DeleteCollectionCommand,
  ListFacesCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import { runPublicEnrollmentSmoke } from './public-enrollment-smoke.mjs';
import { SYNTHETIC_CLIENT_REPORTS } from './lib/enrollment-error-metrics.mjs';
import {
  ephemeralCollectionId,
  requireEphemeralCollectionNamespace,
} from './lib/ephemeralCollections.mjs';

requireEphemeralCollectionNamespace();

const api = process.env.EPHEMERAL_API_ENDPOINT?.replace(/\/$/, '');
const idToken = process.env.EPHEMERAL_ID_TOKEN;
const table = process.env.EPHEMERAL_DYNAMODB_TABLE_NAME;
const origin = process.env.EPHEMERAL_FRONTEND_ORIGIN;
assert(
  api && idToken && table && origin,
  'Deployed PR outputs and synthetic organizer token required.',
);
const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION }),
);
const rekognition = new RekognitionClient({ region: process.env.AWS_REGION });
async function call(path, init = {}, status = 200) {
  const response = await fetch(`${api}${path}`, init);
  assert.equal(
    response.status,
    status,
    `Acceptance API returned ${response.status}, expected ${status}.`,
  );
  return status === 204 ? undefined : response.json();
}
async function admin(path, body, status = 200) {
  return call(
    path,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${idToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    status,
  );
}
async function item(PK, SK) {
  return (
    await db.send(
      new GetCommand({
        TableName: table,
        Key: { PK, SK },
        ConsistentRead: true,
      }),
    )
  ).Item;
}
function runScript(file, env = {}) {
  execFileSync(process.execPath, [file], {
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
}
const created = await admin(
  '/admin/events',
  {
    name: `Synthetic public acceptance ${randomUUID()}`,
    date: '2030-01-01T12:00:00.000Z',
    retentionDays: 1,
  },
  201,
);
const eventId = created.eventId;
assert.match(eventId, /^evt-[A-Za-z0-9-]+$/);
const grants = [];
const browser = await chromium.launch();
const acceptanceStartedAt = Date.now();
let primaryFailure;
const cleanupFailures = [];
try {
  console.log('Public acceptance: checking no-face enrollment in Chromium.');
  const page = await browser.newPage();
  // Only the blank origin document is supplied locally. API, preflight, S3,
  // DynamoDB, indexing and matching use the deployed PR services.
  const document = `${origin}/__findly_public_acceptance`;
  await page.route(document, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Synthetic acceptance</title>',
    }),
  );
  await page.goto(document);
  // Active Chromium routing bypasses CORS preflight even for unmatched URLs.
  // Restore native networking before the real API/S3 requests.
  await page.unroute(document);
  const options = {
    page,
    apiEndpoint: api,
    eventId,
    onRegistration: (grant) => {
      grants.push(grant);
    },
  };
  // The telemetry handler is a separate deployed Lambda. This browser probe
  // calls the real endpoint with native CORS before the all-handler log check.
  const telemetryStatuses = await page.evaluate(
    async ({ api, reports }) => {
      const post = (body) =>
        fetch(`${api}/telemetry/enrollment-errors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then((response) => response.status);
      const accepted = [];
      for (const report of reports) accepted.push(await post(report));
      const rejected = await post({
        ...reports[0],
        registrationId: 'synthetic-forbidden-field',
      });
      return { accepted, rejected };
    },
    { api, reports: SYNTHETIC_CLIENT_REPORTS },
  );
  assert.deepEqual(
    telemetryStatuses.accepted,
    SYNTHETIC_CLIENT_REPORTS.map(() => 204),
    'Synthetic enrollment telemetry was not accepted.',
  );
  assert.equal(
    telemetryStatuses.rejected,
    400,
    'Enrollment telemetry accepted an extra identifier field.',
  );
  console.log(
    'Public acceptance: enrollment telemetry accepted all three stages and rejected an extra field with native browser CORS.',
  );
  await runPublicEnrollmentSmoke(options);
  const failed = await item(
    `EVENT#${eventId}`,
    `REG#${grants[0].registrationId}`,
  );
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.faceId, undefined);
  console.log(
    'Public acceptance: no-face enrollment reached FAILED; checking synthetic face enrollment.',
  );
  // Generated fictional adult fixture, never a photograph submitted by a person.
  const jpeg = readFileSync('e2e/fixtures/synthetic-adult-face.jpg');
  await runPublicEnrollmentSmoke({
    ...options,
    syntheticJpeg: jpeg.toString('base64'),
    expectedStatus: 'ENROLLED',
  });
  const enrolled = grants.at(-1);
  const registration = await item(
    `EVENT#${eventId}`,
    `REG#${enrolled.registrationId}`,
  );
  assert.equal(registration.status, 'ENROLLED');
  assert.equal(typeof registration.faceId, 'string');
  assert.equal(registration.GSI1PK, `FACE#${registration.faceId}`);
  assert.equal(registration.GSI1SK, `REG#${enrolled.registrationId}`);
  console.log(
    'Public acceptance: enrollment reached ENROLLED; waiting for S3-triggered photo matching (up to 2 minutes).',
  );
  const uploads = await admin(`/admin/events/${eventId}/photos/uploads`, {
    files: [{ fileName: 'synthetic-matching.jpg', contentType: 'image/jpeg' }],
  });
  const upload = uploads.uploads[0];
  async function uploadPhoto() {
    const response = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg' },
      body: jpeg,
    });
    assert.equal(response.status, 200, 'Synthetic event photo PUT failed.');
  }
  await uploadPhoto();
  const matchStartedAt = Date.now();
  const deadline = matchStartedAt + 120000;
  let nextMatchProgressAt = matchStartedAt + 30000;
  let match;
  while (Date.now() < deadline) {
    match = await item(
      `REG#${enrolled.registrationId}`,
      `MATCH#${upload.photoId}`,
    );
    if (match) break;
    if (Date.now() >= nextMatchProgressAt) {
      console.log(
        `Public acceptance: still waiting for S3-triggered matching; ${Math.floor((Date.now() - matchStartedAt) / 1000)}s elapsed (limit: 120s).`,
      );
      nextMatchProgressAt = Date.now() + 30000;
    }
    await setTimeout(1500);
  }
  assert(
    match && match.similarity >= 95,
    'S3-triggered matching did not persist the synthetic match.',
  );
  assert.equal(
    match.ttl,
    registration.ttl,
    'Match retention must inherit registration expiry.',
  );
  const gallery = await call(
    `/gallery?token=${encodeURIComponent(enrolled.galleryToken)}`,
  );
  assert.equal(gallery.photos.length, 1);
  assert.equal(gallery.photos[0].photoId, upload.photoId);
  assert.equal((await fetch(gallery.photos[0].url)).status, 200);
  console.log(
    'Public acceptance: matching and private gallery passed; checking duplicate delivery and erasure.',
  );
  await uploadPhoto();
  // Duplicate delivery is exercised, while deterministic non-overwrite is also
  // tested in unit tests. This count alone does not prove consumer completion.
  await setTimeout(5000);
  const duplicates = await db.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `REG#${enrolled.registrationId}` },
      ConsistentRead: true,
    }),
  );
  assert.equal(duplicates.Items.length, 1);
  assert.equal(duplicates.Items[0].matchId, match.matchId);
  await call(
    `/registrations/${enrolled.registrationId}`,
    { method: 'DELETE', headers: { 'X-Gallery-Token': enrolled.galleryToken } },
    204,
  );
  await call(
    `/gallery?token=${encodeURIComponent(enrolled.galleryToken)}`,
    {},
    404,
  );
  assert.equal(
    await item(`EVENT#${eventId}`, `REG#${enrolled.registrationId}`),
    undefined,
  );
  assert.equal(
    await item(`REG#${enrolled.registrationId}`, `MATCH#${upload.photoId}`),
    undefined,
  );
  const faces = await rekognition.send(
    new ListFacesCommand({ CollectionId: ephemeralCollectionId(eventId) }),
  );
  assert(
    !faces.Faces?.some((face) => face.FaceId === registration.faceId),
    'Erasure left the synthetic enrolled FaceId.',
  );
  console.log(
    'Deployed browser enrollment FAILED/ENROLLED, synthetic S3 matching, private gallery and actual FaceId erasure passed.',
  );
} catch (error) {
  primaryFailure = error;
  for (const grant of grants) {
    try {
      const registration = await item(
        `EVENT#${eventId}`,
        `REG#${grant.registrationId}`,
      );
      const allowedStatuses = [
        'UPLOAD_PENDING',
        'PROCESSING',
        'ENROLLED',
        'FAILED',
      ];
      console.log('Acceptance registration state', {
        exists: Boolean(registration),
        status: allowedStatuses.includes(registration?.status)
          ? registration.status
          : 'UNKNOWN',
        hasFaceId: Boolean(registration?.faceId),
        hasProcessingClaim: Boolean(registration?.processingClaim),
        erasureRequested: Boolean(registration?.erasureRequestedAt),
      });
    } catch {
      console.log('Acceptance registration state unavailable');
    }
  }
  // Preserve only safe error categories before Terraform removes log groups.
  for (const handler of ['selfie-indexer', 'photo-matcher']) {
    try {
      const result = JSON.parse(
        execFileSync(
          'aws',
          [
            'logs',
            'filter-log-events',
            '--start-time',
            String(acceptanceStartedAt),
            '--log-group-name',
            `/aws/lambda/${process.env.EPHEMERAL_RESOURCE_PREFIX}-${handler}`,
            '--output',
            'json',
          ],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ),
      );
      const counts = new Map();
      let invocationStarts = 0;
      for (const record of result.events ?? []) {
        const message = record.message ?? '';
        if (message.startsWith('START RequestId:')) invocationStarts++;
        const start = message.indexOf('{');
        if (start < 0) continue;
        let entry;
        try {
          entry = JSON.parse(message.slice(start));
        } catch {
          continue;
        }
        if (
          entry.level !== 'ERROR' ||
          !/^[A-Za-z0-9_]{1,80}$/.test(entry.errorName ?? '')
        )
          continue;
        const step = [
          'index_faces',
          'search_faces',
          'write_match',
          'delete_faces',
        ].includes(entry.step)
          ? entry.step
          : 'unknown';
        const category = `${step}:${entry.errorName}`;
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
      console.log('Acceptance error categories', handler, {
        invocationStarts,
        errors: Object.fromEntries(counts),
      });
    } catch {
      console.log('Acceptance error categories unavailable', handler);
    }
  }
} finally {
  await browser.close().catch(() => cleanupFailures.push('browser'));
  for (const grant of grants) {
    try {
      const response = await fetch(
        `${api}/registrations/${grant.registrationId}`,
        {
          method: 'DELETE',
          headers: { 'X-Gallery-Token': grant.galleryToken },
        },
      );
      if (![204, 404].includes(response.status))
        cleanupFailures.push('registration');
    } catch {
      cleanupFailures.push('registration');
    }
  }
  // Collections are created dynamically and are not in Terraform state.
  try {
    await rekognition.send(
      new DeleteCollectionCommand({
        CollectionId: ephemeralCollectionId(eventId),
      }),
    );
  } catch (error) {
    if (error.name !== 'ResourceNotFoundException')
      cleanupFailures.push('collection');
  }
}
if (primaryFailure) throw primaryFailure;
assert.equal(cleanupFailures.length, 0, 'Synthetic acceptance cleanup failed.');
console.log(
  'Public acceptance: browser flow and synthetic cleanup passed; checking upload security.',
);
runScript('scripts/deployed-upload-security.mjs');
console.log(
  'Public acceptance: upload security passed; checking retention and erasure.',
);
runScript('scripts/deployed-ephemeral-erasure.mjs');
console.log('Public acceptance: erasure passed; checking DLQ redrive.');
runScript('scripts/deployed-dlq-redrive.mjs', {
  EPHEMERAL_KEEP_POISON_IN_DLQ: '1',
});
console.log(
  'Public acceptance: DLQ redrive passed; waiting for real CloudWatch alarm, SNS delivery and Lambda log evidence (up to 12 minutes).',
);
runScript('scripts/deployed-observability.mjs');
