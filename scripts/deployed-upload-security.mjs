import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { chromium } from '@playwright/test';

const api = process.env.EPHEMERAL_API_ENDPOINT?.replace(/\/$/, '');
const token = process.env.EPHEMERAL_ID_TOKEN;
const bucket = process.env.EPHEMERAL_UPLOADS_BUCKET_NAME;
const origin = process.env.EPHEMERAL_FRONTEND_ORIGIN;
assert(
  api && token && bucket && origin,
  'API, token, bucket and exact frontend origin are required.',
);
assert.equal(
  new URL(origin).origin,
  origin,
  'Frontend origin must not contain a path.',
);
const s3 = new S3Client({ region: process.env.AWS_REGION });
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

async function admin(path, body, expectedStatus = 200) {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  assert.equal(
    response.status,
    expectedStatus,
    `Admin request ${path} failed with ${response.status}.`,
  );
  return response.json();
}
const event = await admin(
  '/admin/events',
  {
    name: `Synthetic upload security ${randomUUID()}`,
    date: '2030-01-01T12:00:00.000Z',
    retentionDays: 1,
  },
  201,
);
async function issueUrl() {
  const issued = await admin(
    `/admin/events/${encodeURIComponent(event.eventId)}/photos/uploads`,
    {
      files: [
        { fileName: 'synthetic-security.jpg', contentType: 'image/jpeg' },
      ],
    },
  );
  const url = new URL(issued.uploads[0].uploadUrl);
  assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
  assert(
    url.searchParams
      .get('X-Amz-SignedHeaders')
      ?.split(';')
      .includes('content-type'),
    'Content-Type must be signed.',
  );
  return url;
}
function keyOf(url) {
  // AWS deployed buckets use virtual-hosted endpoints, never local path style.
  assert(
    url.hostname.startsWith(`${bucket}.`),
    'Unexpected signed bucket endpoint.',
  );
  return decodeURIComponent(url.pathname.slice(1));
}
async function absent(url) {
  const key = keyOf(url);
  // HEAD has no s3:prefix context and would require unconditioned ListBucket
  // permission to distinguish missing objects from denial. A scoped listing
  // proves absence without broadening the CI role. An exact key sorts before
  // any longer key sharing its prefix, so one result is sufficient.
  const listed = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: key, MaxKeys: 1 }),
  );
  assert(
    !(listed.Contents ?? []).some((object) => object.Key === key),
    'A rejected upload created an object.',
  );
}
// Each mutation has a fresh key so a previous successful PUT cannot hide failure.
for (const mutation of ['method', 'key', 'content-type']) {
  const original = await issueUrl();
  const changed = new URL(original);
  if (mutation === 'key') changed.pathname += '-tampered';
  const response = await fetch(changed, {
    method: mutation === 'method' ? 'POST' : 'PUT',
    headers: {
      'content-type': mutation === 'content-type' ? 'image/png' : 'image/jpeg',
    },
    body: jpeg,
  });
  assert.equal(
    response.status,
    403,
    `S3 must reject the ${mutation} mutation.`,
  );
  // Do not emit error payloads, request URLs, signatures or token-bearing headers.
  await absent(original);
  if (mutation === 'key') await absent(changed);
}

const browser = await chromium.launch();
try {
  for (const allowed of [true, false]) {
    const url = await issueUrl();
    const page = await browser.newPage();
    const pageOrigin = allowed
      ? origin
      : 'https://findly-forbidden-origin.invalid';
    const document = `${pageOrigin}/__findly_s3_security_probe`;
    // Only the blank document is local; preflight and PUT go to deployed S3.
    await page.route(document, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Findly synthetic security probe</title>',
      }),
    );
    await page.goto(document);
    const result = await page.evaluate(
      async ({ uploadUrl }) => {
        try {
          const canvas = globalThis.document.createElement('canvas');
          canvas.width = 64;
          canvas.height = 64;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Synthetic canvas unavailable.');
          context.fillStyle = '#4488aa';
          context.fillRect(0, 0, 64, 64);
          const body = await new Promise((resolve, reject) =>
            canvas.toBlob(
              (blob) =>
                blob
                  ? resolve(blob)
                  : reject(new Error('JPEG encoding failed.')),
              'image/jpeg',
            ),
          );
          const response = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'content-type': 'image/jpeg' },
            body,
          });
          return { success: response.ok, status: response.status };
        } catch {
          return { success: false, status: null };
        }
      },
      { uploadUrl: url.toString() },
    );
    if (allowed) {
      assert.equal(
        result.success,
        true,
        'Allowed browser origin cannot upload.',
      );
      const object = await s3.send(
        new HeadObjectCommand({ Bucket: bucket, Key: keyOf(url) }),
      );
      assert.equal(object.ContentType, 'image/jpeg');
      assert.equal(object.ServerSideEncryption, 'AES256');
    } else {
      assert.equal(result.success, false, 'Forbidden browser origin uploaded.');
      await absent(url);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(
  'AWS signature mutations, exact browser CORS and SSE-S3 passed with synthetic data; stack destroy must remove seeded metadata and objects.',
);
