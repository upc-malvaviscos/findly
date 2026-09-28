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
let primaryFailure;
const cleanupFailures = [];
try {
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
  const options = {
    page,
    apiEndpoint: api,
    eventId,
    onRegistration: (grant) => {
      grants.push(grant);
    },
  };
  await runPublicEnrollmentSmoke(options);
  const failed = await item(
    `EVENT#${eventId}`,
    `REG#${grants[0].registrationId}`,
  );
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.faceId, undefined);
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
  const deadline = Date.now() + 120000;
  let match;
  while (Date.now() < deadline) {
    match = await item(
      `REG#${enrolled.registrationId}`,
      `MATCH#${upload.photoId}`,
    );
    if (match) break;
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
runScript('scripts/deployed-upload-security.mjs');
runScript('scripts/deployed-ephemeral-erasure.mjs');
runScript('scripts/deployed-dlq-redrive.mjs', {
  EPHEMERAL_KEEP_POISON_IN_DLQ: '1',
});
runScript('scripts/deployed-observability.mjs');
