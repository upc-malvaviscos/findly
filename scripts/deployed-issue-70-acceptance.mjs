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
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
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
const bucket = process.env.EPHEMERAL_UPLOADS_BUCKET_NAME;
assert(
  api && idToken && table && origin && bucket,
  'Deployed PR outputs and synthetic organizer token required.',
);
const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION }),
);
const rekognition = new RekognitionClient({ region: process.env.AWS_REGION });
const s3 = new S3Client({ region: process.env.AWS_REGION });
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
async function objectExists(key) {
  const result = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: key, MaxKeys: 1 }),
  );
  return Boolean(result.Contents?.some((object) => object.Key === key));
}
async function waitForMatch(registrationId, photoId, budgetMs) {
  const deadline = Date.now() + budgetMs;
  let match;
  while (Date.now() < deadline) {
    match = await item(`REG#${registrationId}`, `MATCH#${photoId}`);
    if (match) return match;
    await setTimeout(1500);
  }
  return undefined;
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
    files: [
      {
        operationId: randomUUID(),
        fileName: 'synthetic-matching.jpg',
        contentType: 'image/jpeg',
      },
    ],
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
  const inlineUrl = gallery.photos[0].url;
  const downloadUrl = gallery.photos[0].downloadUrl;
  assert.equal(typeof downloadUrl, 'string');
  assert.notEqual(downloadUrl, inlineUrl);
  assert.equal((await fetch(inlineUrl)).status, 200);
  assert.equal((await fetch(downloadUrl)).status, 200);
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
  console.log(
    'Public acceptance: duplicate delivery passed; checking admin event/photo management.',
  );
  const authHeader = { authorization: `Bearer ${idToken}` };
  const ttlBeforeRetentionEdit = {
    registration: (
      await item(`EVENT#${eventId}`, `REG#${enrolled.registrationId}`)
    ).ttl,
    photo: (await item(`EVENT#${eventId}`, `PHOTO#${upload.photoId}`)).ttl,
  };
  const renamed = await call(`/admin/events/${eventId}`, {
    method: 'PATCH',
    headers: { ...authHeader, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `Synthetic public acceptance ${randomUUID()} (renamed)`,
      retentionDays: 2,
    }),
  });
  assert.equal(renamed.eventId, eventId);
  assert.match(renamed.name, /\(renamed\)$/);
  assert.equal(renamed.retentionDays, 2);
  console.log(
    "Public acceptance: checking an edited event's retentionDays did not rewrite existing ttl.",
  );
  assert.equal(
    (await item(`EVENT#${eventId}`, `REG#${enrolled.registrationId}`)).ttl,
    ttlBeforeRetentionEdit.registration,
    'Editing retentionDays must not rewrite an existing registration ttl.',
  );
  assert.equal(
    (await item(`EVENT#${eventId}`, `PHOTO#${upload.photoId}`)).ttl,
    ttlBeforeRetentionEdit.photo,
    'Editing retentionDays must not rewrite an existing photo ttl.',
  );
  console.log(
    'Public acceptance: checking the public /events listing reflects the admin rename.',
  );
  const publicEvents = await call('/events');
  const publicListedEvent = publicEvents.events.find(
    (candidate) => candidate.eventId === eventId,
  );
  assert(
    publicListedEvent,
    'The edited event did not appear in the public /events listing.',
  );
  assert.equal(
    publicListedEvent.name,
    renamed.name,
    'The public /events listing did not reflect the admin rename.',
  );
  console.log(
    'Public acceptance: checking JWT rejection on the four new admin routes.',
  );
  const invalidAuthHeader = { authorization: 'Bearer not-a-real-jwt' };
  const adminRouteChecks = [
    {
      label: 'PATCH /admin/events/{id}',
      path: `/admin/events/${eventId}`,
      init: (headers) => ({
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Unauthorized rename attempt' }),
      }),
    },
    {
      label: 'GET /admin/events/{id}/photos',
      path: `/admin/events/${eventId}/photos`,
      init: (headers) => ({ headers }),
    },
    {
      label: 'DELETE /admin/events/{id}/photos/{photoId}',
      path: `/admin/events/${eventId}/photos/${upload.photoId}`,
      init: (headers) => ({ method: 'DELETE', headers }),
    },
    {
      label: 'DELETE /admin/events/{id}',
      path: `/admin/events/${eventId}`,
      init: (headers) => ({ method: 'DELETE', headers }),
    },
  ];
  for (const { label, path, init } of adminRouteChecks) {
    const withoutToken = await fetch(`${api}${path}`, init({}));
    assert.equal(
      withoutToken.status,
      401,
      `${label} must reject a missing JWT.`,
    );
    const withInvalidToken = await fetch(
      `${api}${path}`,
      init(invalidAuthHeader),
    );
    assert.equal(
      withInvalidToken.status,
      401,
      `${label} must reject an invalid JWT.`,
    );
  }
  // Confirm none of the eight rejected attempts above had any effect.
  const untouchedEvent = await item(`EVENT#${eventId}`, 'METADATA');
  assert.equal(
    untouchedEvent.name,
    renamed.name,
    'An unauthorized PATCH must not have changed the event.',
  );
  assert.equal(
    untouchedEvent.status,
    'OPEN',
    'An unauthorized DELETE must not have closed the primary event.',
  );
  assert(
    await item(`EVENT#${eventId}`, `PHOTO#${upload.photoId}`),
    'An unauthorized DELETE must not have removed the matched photo.',
  );
  console.log(
    'Public acceptance: JWT rejection passed; checking photo listing.',
  );
  const photosPage = await call(`/admin/events/${eventId}/photos`, {
    headers: authHeader,
  });
  assert(
    photosPage.photos.some((photo) => photo.photoId === upload.photoId),
    'Photo listing did not include the matched synthetic photo.',
  );
  console.log(
    'Public acceptance: checking paginated photo listing across two real pages.',
  );
  {
    const paginationEvent = await admin(
      '/admin/events',
      {
        name: `Synthetic pagination event ${randomUUID()}`,
        date: '2030-01-01T12:00:00.000Z',
        retentionDays: 1,
      },
      201,
    );
    // adminEvents.ts PHOTO_PAGE_SIZE = 20; 21 photos force a real second page.
    const PAGINATION_PHOTO_COUNT = 21;
    const paginationPhotoIds = [];
    for (let i = 0; i < PAGINATION_PHOTO_COUNT; i++) {
      const paginationUpload = (
        await admin(`/admin/events/${paginationEvent.eventId}/photos/uploads`, {
          files: [
            {
              operationId: randomUUID(),
              fileName: `pagination-${i}.jpg`,
              contentType: 'image/jpeg',
            },
          ],
        })
      ).uploads[0];
      assert.equal(
        (
          await fetch(paginationUpload.uploadUrl, {
            method: 'PUT',
            headers: { 'content-type': 'image/jpeg' },
            body: jpeg,
          })
        ).status,
        200,
      );
      paginationPhotoIds.push(paginationUpload.photoId);
    }
    const paginationPage1 = await call(
      `/admin/events/${paginationEvent.eventId}/photos`,
      { headers: authHeader },
    );
    assert.equal(
      paginationPage1.photos.length,
      20,
      'The first photo page did not return 20 photos.',
    );
    assert.equal(
      typeof paginationPage1.nextCursor,
      'string',
      'A 21-photo event did not return a pagination cursor.',
    );
    const paginationPage2 = await call(
      `/admin/events/${paginationEvent.eventId}/photos?cursor=${encodeURIComponent(paginationPage1.nextCursor)}`,
      { headers: authHeader },
    );
    assert.equal(
      paginationPage2.photos.length,
      1,
      'The second photo page did not return the remaining photo.',
    );
    assert.equal(
      paginationPage2.nextCursor,
      undefined,
      'The final photo page must not return another cursor.',
    );
    const paginatedIds = new Set(
      [...paginationPage1.photos, ...paginationPage2.photos].map(
        (photo) => photo.photoId,
      ),
    );
    assert.equal(
      paginatedIds.size,
      PAGINATION_PHOTO_COUNT,
      'Paginated listing did not cover every uploaded photo exactly once.',
    );
    for (const photoId of paginationPhotoIds)
      assert(
        paginatedIds.has(photoId),
        'A paginated photo page skipped a photo.',
      );
    await call(
      `/admin/events/${paginationEvent.eventId}`,
      { method: 'DELETE', headers: authHeader },
      204,
    );
  }
  console.log('Public acceptance: paginated photo listing passed.');
  // A disposable second photo, not upload.photoId: deleting it must not
  // disturb the duplicate-delivery/erasure checks that still depend on it.
  console.log(
    'Public acceptance: checking a matched photo deletion removes S3, matches and the gallery entry.',
  );
  const disposableOperationId = randomUUID();
  const disposablePhoto = (
    await admin(`/admin/events/${eventId}/photos/uploads`, {
      files: [
        {
          operationId: disposableOperationId,
          fileName: 'synthetic-disposable.jpg',
          contentType: 'image/jpeg',
        },
      ],
    })
  ).uploads[0];
  assert.equal(
    (
      await fetch(disposablePhoto.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        body: jpeg,
      })
    ).status,
    200,
  );
  const disposableMatch = await waitForMatch(
    enrolled.registrationId,
    disposablePhoto.photoId,
    90000,
  );
  assert(
    disposableMatch,
    'The disposable photo never produced a match to delete against.',
  );
  const galleryBeforeDelete = await call(
    `/gallery?token=${encodeURIComponent(enrolled.galleryToken)}`,
  );
  assert(
    galleryBeforeDelete.photos.some(
      (photo) => photo.photoId === disposablePhoto.photoId,
    ),
    'The gallery did not list the disposable photo before deleting it.',
  );
  await call(
    `/admin/events/${eventId}/photos/${disposablePhoto.photoId}`,
    { method: 'DELETE', headers: authHeader },
    204,
  );
  // Issue #121: deleteEventPhoto leaves a tombstone (deletedAt, no s3Key/
  // fileName) instead of removing the row, so a reused operationId is
  // rejected rather than silently recreating the photo.
  const tombstone = await item(
    `EVENT#${eventId}`,
    `PHOTO#${disposablePhoto.photoId}`,
  );
  assert(tombstone?.deletedAt, 'Deleted photo did not leave a tombstone.');
  assert.equal(
    tombstone.s3Key,
    undefined,
    'Tombstone still carries the deleted S3 key.',
  );
  assert.equal(
    tombstone.fileName,
    undefined,
    'Tombstone still carries the deleted file name.',
  );
  const retriedDeletedUpload = (
    await admin(`/admin/events/${eventId}/photos/uploads`, {
      files: [
        {
          operationId: disposableOperationId,
          fileName: 'synthetic-disposable.jpg',
          contentType: 'image/jpeg',
        },
      ],
    })
  ).uploads[0];
  assert.equal(
    retriedDeletedUpload?.error,
    'PHOTO_DELETED',
    'Retrying a deleted photo operation did not reject against real AWS.',
  );
  assert.equal(
    await item(
      `REG#${enrolled.registrationId}`,
      `MATCH#${disposablePhoto.photoId}`,
    ),
    undefined,
    'Deleted photo left an orphaned match.',
  );
  assert.equal(
    await objectExists(
      `events/${eventId}/photos/${disposablePhoto.photoId}.photo.jpg`,
    ),
    false,
    'Deleted photo left its S3 object behind.',
  );
  const galleryAfterDelete = await call(
    `/gallery?token=${encodeURIComponent(enrolled.galleryToken)}`,
  );
  assert.equal(
    galleryAfterDelete.photos.length,
    1,
    'The gallery still listed the deleted photo.',
  );
  assert.equal(galleryAfterDelete.photos[0].photoId, upload.photoId);
  // A disposable second event, not eventId: ADR-023 closes it immediately
  // (status=CLOSED) but defers the Rekognition collection/event-row delete
  // to the next retention pass, so this must not run against the primary
  // event the rest of this script still depends on. It still carries a
  // real enrolled registration and a real matched photo, so deleting it
  // exercises deleteEventRecords'/deleteEventObjects' full synchronous
  // cleanup, not just the CLOSED marker.
  console.log(
    'Public acceptance: checking full synchronous cleanup of a deleted event with real data.',
  );
  const disposableEvent = await admin(
    '/admin/events',
    {
      name: `Synthetic disposable event ${randomUUID()}`,
      date: '2030-01-01T12:00:00.000Z',
      retentionDays: 1,
    },
    201,
  );
  const disposablePage = await browser.newPage();
  let disposableGrant;
  try {
    const disposableDocument = `${origin}/__findly_public_acceptance_disposable`;
    await disposablePage.route(disposableDocument, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Synthetic acceptance</title>',
      }),
    );
    await disposablePage.goto(disposableDocument);
    await disposablePage.unroute(disposableDocument);
    await runPublicEnrollmentSmoke({
      page: disposablePage,
      apiEndpoint: api,
      eventId: disposableEvent.eventId,
      onRegistration: (grant) => {
        disposableGrant = grant;
      },
      syntheticJpeg: jpeg.toString('base64'),
      expectedStatus: 'ENROLLED',
    });
  } finally {
    await disposablePage.close();
  }
  const disposableRegistration = await item(
    `EVENT#${disposableEvent.eventId}`,
    `REG#${disposableGrant.registrationId}`,
  );
  assert.equal(disposableRegistration.status, 'ENROLLED');
  const disposableUpload = (
    await admin(`/admin/events/${disposableEvent.eventId}/photos/uploads`, {
      files: [
        {
          operationId: randomUUID(),
          fileName: 'synthetic-disposable-event.jpg',
          contentType: 'image/jpeg',
        },
      ],
    })
  ).uploads[0];
  assert.equal(
    (
      await fetch(disposableUpload.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        body: jpeg,
      })
    ).status,
    200,
  );
  const disposableEventMatch = await waitForMatch(
    disposableGrant.registrationId,
    disposableUpload.photoId,
    90000,
  );
  assert(
    disposableEventMatch,
    'The disposable event photo never produced a match to delete against.',
  );
  await call(
    `/admin/events/${disposableEvent.eventId}`,
    { method: 'DELETE', headers: authHeader },
    204,
  );
  const closedEvent = await item(
    `EVENT#${disposableEvent.eventId}`,
    'METADATA',
  );
  assert.equal(
    closedEvent?.status,
    'CLOSED',
    'Deleted event was not marked CLOSED (ADR-023).',
  );
  assert.equal(
    await item(
      `EVENT#${disposableEvent.eventId}`,
      `REG#${disposableGrant.registrationId}`,
    ),
    undefined,
    'Deleting the event left the registration behind.',
  );
  assert.equal(
    await item(
      `REG#${disposableGrant.registrationId}`,
      `MATCH#${disposableUpload.photoId}`,
    ),
    undefined,
    'Deleting the event left an orphaned match.',
  );
  assert.equal(
    await objectExists(
      `events/${disposableEvent.eventId}/selfies/${disposableGrant.registrationId}.selfie.jpg`,
    ),
    false,
    'Deleting the event left the selfie S3 object behind.',
  );
  assert.equal(
    await objectExists(
      `events/${disposableEvent.eventId}/photos/${disposableUpload.photoId}.photo.jpg`,
    ),
    false,
    'Deleting the event left the photo S3 object behind.',
  );
  await call(
    `/gallery?token=${encodeURIComponent(disposableGrant.galleryToken)}`,
    {},
    404,
  );
  console.log(
    'Public acceptance: checking a closed event rejects new registrations and uploads.',
  );
  // publicEnrollment.ts treats a non-OPEN event as 404 EVENT_NOT_FOUND (410
  // is reserved there for an event that is OPEN but past its retention
  // expiry); createPhotoUploads instead returns 410 EVENT_EXPIRED for both
  // a closed and an expired event. Pre-existing, unrelated inconsistency
  // between the two handlers; each check below matches its real contract.
  await call(
    `/events/${disposableEvent.eventId}/registrations`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'synthetic@example.com',
        consentBiometrics: true,
        consentTerms: true,
      }),
    },
    404,
  );
  await admin(
    `/admin/events/${disposableEvent.eventId}/photos/uploads`,
    {
      files: [
        {
          operationId: randomUUID(),
          fileName: 'synthetic-after-close.jpg',
          contentType: 'image/jpeg',
        },
      ],
    },
    410,
  );
  console.log(
    'Public acceptance: admin event/photo management passed; checking erasure.',
  );
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
    'Deployed browser enrollment FAILED/ENROLLED, synthetic S3 matching, private gallery and actual FaceId erasure passed; checking that already-issued S3 URLs survive it and no identifier leaked to logs.',
  );
  // Sharing/deletion revokes the gallery *endpoint* (checked above as 404),
  // but spec 22 explicitly does not promise instant revocation of S3
  // capabilities already handed to a browser before the deletion happened.
  const survivingInline = await fetch(inlineUrl);
  assert.equal(
    survivingInline.status,
    200,
    'An already-issued inline URL must keep working until its own expiry.',
  );
  const survivingDownload = await fetch(downloadUrl);
  assert.equal(
    survivingDownload.status,
    200,
    'An already-issued download URL must keep working until its own expiry.',
  );
  assert.equal(
    survivingDownload.headers.get('content-disposition'),
    `attachment; filename="findly-${upload.photoId}.jpg"`,
  );
  assert(
    (await survivingDownload.arrayBuffer()).byteLength > 0,
    'The surviving download URL must still return the photo bytes.',
  );
  await setTimeout(10000);
  for (const handler of ['gallery-reader', 'delete-registration']) {
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
    const messages = (result.events ?? []).map((event) => event.message);
    assert(
      messages.length,
      `Expected application log evidence for ${handler}.`,
    );
    for (const identifier of [enrolled.galleryToken, enrolled.registrationId])
      assert(
        !messages.some((message) => message.includes(identifier)),
        `The ${handler} logs leaked an identifier they must never contain.`,
      );
  }
  console.log(
    'Already-issued S3 URLs survived erasure as documented, and gallery-reader/delete-registration logs carried no gallery token or registrationId.',
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
