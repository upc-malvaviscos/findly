import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { awsCommand as aws } from './lib/aws-command.mjs';
import { demoConfiguration } from './lib/demo-controls.mjs';
import { requireDemoTags } from './lib/demo-cleanup.mjs';
import { runPublicEnrollmentSmoke } from './public-enrollment-smoke.mjs';

const config = demoConfiguration(process.env);
assert.equal(aws('sts', 'get-caller-identity').Account, config.account);
const outputs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const value = (name) => outputs[name]?.value;
assert.equal(value('uploads_bucket_name'), config.uploadsBucket);
assert.equal(value('web_bucket_name'), config.webBucket);
assert.equal(value('collection_namespace'), 'findly-demo');
const origin = value('frontend_origin');
assert(origin.startsWith('https://'), 'HTTPS demo required');
assert.equal(new URL(origin).origin, origin);
const apiEndpoint = value('api_endpoint');
assert(
  /^https:\/\/[a-z0-9]+\.execute-api\.eu-west-1\.amazonaws\.com\/?$/.test(
    apiEndpoint,
  ),
  'Unexpected demo API',
);
const pool = value('cognito_user_pool_id');
requireDemoTags(
  aws('cognito-idp', 'describe-user-pool', { UserPoolId: pool }).UserPool
    .UserPoolTags,
);
const username = `demo-smoke-${randomUUID()}`;
const password = `${randomBytes(24).toString('base64url')}Aa1!`;
const photo = readFileSync(
  new URL('../e2e/fixtures/synthetic-adult-face.jpg', import.meta.url),
);
let browser;
let userCreated = false;
let registration;
let stage = 'organizer setup';
try {
  aws('cognito-idp', 'admin-create-user', {
    UserPoolId: pool,
    Username: username,
    MessageAction: 'SUPPRESS',
  });
  userCreated = true;
  aws('cognito-idp', 'admin-set-user-password', {
    UserPoolId: pool,
    Username: username,
    Password: password,
    Permanent: true,
  });
  browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  stage = 'published SPA and Cognito login';
  await page.goto(`${origin}/admin/events`, { waitUntil: 'networkidle' });
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('heading', { name: 'Tus eventos' }).waitFor();
  stage = 'event creation through browser';
  await page
    .getByLabel('Nombre del evento')
    .fill(`Synthetic demo smoke ${randomUUID()}`);
  await page
    .getByLabel('Fecha')
    .fill(new Date(Date.now() + 60000).toISOString().slice(0, 16));
  await page.getByLabel('Retención (días)').fill('1');
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url() === `${apiEndpoint.replace(/\/$/, '')}/admin/events` &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Crear evento' }).click();
  const created = await createdResponse;
  assert.equal(created.status(), 201);
  const { eventId } = await created.json();
  assert.equal(
    await page.getByLabel('Evento seleccionado').inputValue(),
    eventId,
  );
  stage = 'public enrollment, browser CORS and real face indexing';
  await runPublicEnrollmentSmoke({
    page,
    apiEndpoint,
    eventId,
    syntheticJpeg: photo.toString('base64'),
    expectedStatus: 'ENROLLED',
    onRegistration: async (value) => {
      registration = value;
    },
  });
  stage = 'organizer photo upload';
  await page.locator('input[type="file"]').setInputFiles({
    name: 'synthetic-demo-photo.jpg',
    mimeType: 'image/jpeg',
    buffer: photo,
  });
  await page.getByRole('button', { name: 'Subir fotografías' }).click();
  await page.getByText('Progreso global: 100%').waitFor();
  stage = 'real matching and private gallery';
  const deadline = Date.now() + 120000;
  let matched = false;
  while (Date.now() < deadline) {
    const result = await page.evaluate(
      async ({ api, token }) => {
        const response = await fetch(
          `${api}/gallery?token=${encodeURIComponent(token)}`,
        );
        const body = await response.json();
        return { status: response.status, count: body.photos?.length ?? 0 };
      },
      { api: apiEndpoint.replace(/\/$/, ''), token: registration.galleryToken },
    );
    assert.equal(result.status, 200);
    if (result.count === 1) {
      matched = true;
      break;
    }
    await page.waitForTimeout(2000);
  }
  assert(matched, 'Synthetic match did not converge within two minutes');
  await page.goto(
    `${origin}/gallery?token=${encodeURIComponent(registration.galleryToken)}`,
  );
  await page.locator('img').first().waitFor();
  await page.waitForFunction(() =>
    Array.from(globalThis.document.images).some(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  );
  console.log(
    'Permanent demo verified: HTTPS SPA, Cognito, browser event creation, enrollment/CORS, admin upload, actual matching and private gallery image.',
  );
} catch {
  // Playwright errors can include URLs with gallery capabilities. Emit only stage.
  throw new Error(`Permanent demo acceptance failed at: ${stage}`);
} finally {
  if (browser) await browser.close();
  if (registration) {
    const result = await fetch(
      `${apiEndpoint.replace(/\/$/, '')}/registrations/${registration.registrationId}`,
      {
        method: 'DELETE',
        headers: { 'X-Gallery-Token': registration.galleryToken },
      },
    );
    assert(
      [204, 404].includes(result.status),
      'Synthetic registration cleanup failed',
    );
  }
  if (userCreated)
    aws('cognito-idp', 'admin-delete-user', {
      UserPoolId: pool,
      Username: username,
    });
}
