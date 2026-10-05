import { expect, test, type Page } from '@playwright/test';

const API = 'https://api.findly.test';
const UPLOAD_URL = 'https://s3.findly.test/selfies/reg-e2e';

/** HTTP mock that follows the real backend contract (spec 18); synthetic data only. */
async function mockBackend(page: Page) {
  let statusReads = 0;
  const telemetryReports: unknown[] = [];
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(body),
      });
    if (request.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        },
      });
    if (pathname === '/events')
      return json({
        events: [
          {
            eventId: 'demo-2026',
            name: 'Findly Demo Night',
            date: '2026-09-18T19:30:00+02:00',
          },
        ],
      });
    if (pathname === '/events/demo-2026')
      return json({
        eventId: 'demo-2026',
        name: 'Findly Demo Night',
        date: '2026-09-18T19:30:00+02:00',
      });
    if (pathname === '/events/demo-2026/registrations') {
      expect(request.postDataJSON()).toMatchObject({
        consentBiometrics: true,
        consentTerms: true,
      });
      return json(
        {
          registrationId: 'reg-e2e',
          galleryToken: 'synthetic-e2e-token',
          uploadUrl: UPLOAD_URL,
          expiresInSeconds: 300,
        },
        201,
      );
    }
    if (pathname === '/registrations/reg-e2e/status') {
      expect(request.headers()['x-gallery-token']).toBe('synthetic-e2e-token');
      statusReads += 1;
      return json({
        registrationId: 'reg-e2e',
        status: statusReads >= 2 ? 'ENROLLED' : 'PROCESSING',
      });
    }
    if (pathname === '/telemetry/enrollment-errors') {
      telemetryReports.push(request.postDataJSON());
      return route.fulfill({
        status: 204,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }
    if (pathname === '/gallery')
      return json({
        eventId: 'demo-2026',
        eventName: 'Findly Demo Night',
        registrationId: 'registration-demo',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        photos: [1, 2].map((n) => ({
          photoId: `photo-${n}`,
          url: `${API}/photos/${n}.jpg`,
          matchedAt: '2026-09-18T20:04:00+02:00',
        })),
      });
    return json(
      { code: 'NOT_FOUND', message: 'not found', requestId: 'e2e' },
      404,
    );
  });
  await page.route(UPLOAD_URL, (route) => {
    expect(route.request().headers()['content-type']).toBe('image/jpeg');
    expect(route.request().headers()['if-none-match']).toBe('*');
    return route.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
  return telemetryReports;
}

let telemetryReports: unknown[] = [];
test.beforeEach(async ({ page }) => {
  telemetryReports = await mockBackend(page);
});

test('renders the public enrollment page', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.brand')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Encuentra tu momento.' }),
  ).toBeVisible();
});

test('completes the public selfie enrollment flow', async ({ page }) => {
  await page.goto('/?event=demo-2026');
  await page.getByLabel(/Email para tu galería/).fill('ada@example.com');
  await page.getByLabel(/tratamiento biométrico/).check();
  await page.getByLabel(/términos de privacidad/).check();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'selfie.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('synthetic selfie'),
  });

  await page.getByRole('button', { name: 'Enviar mi selfie' }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '100',
  );
  await expect(page.getByText('Registro completado')).toBeVisible({
    timeout: 10000,
  });
});

test('reports a failed selfie upload as a stage and code only (ADR-018)', async ({
  page,
}) => {
  // Registered after the default handler, so it takes precedence: S3 refuses
  // the signed PUT as it would for an expired or tampered URL.
  await page.route(UPLOAD_URL, (route) =>
    route.fulfill({
      status: 403,
      headers: { 'Access-Control-Allow-Origin': '*' },
    }),
  );
  await page.goto('/?event=demo-2026');
  await page.getByLabel(/Email para tu galería/).fill('ada@example.com');
  await page.getByLabel(/tratamiento biométrico/).check();
  await page.getByLabel(/términos de privacidad/).check();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'selfie.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('synthetic selfie'),
  });
  await page.getByRole('button', { name: 'Enviar mi selfie' }).click();
  await expect(
    page.getByText('No hemos podido completar la subida.', { exact: false }),
  ).toBeVisible();
  await expect
    .poll(() => telemetryReports)
    .toEqual([{ stage: 'upload', code: 'UPLOAD_HTTP_4XX' }]);
  expect(JSON.stringify(telemetryReports)).not.toMatch(
    /ada@example|reg-e2e|synthetic-e2e-token|s3\.findly/,
  );
});

test('protects the organizer area and supports logout', async ({ page }) => {
  await page.route('https://cognito-idp.eu-west-1.amazonaws.com/', (route) =>
    route.fulfill({
      contentType: 'application/x-amz-json-1.1',
      body: JSON.stringify({
        AuthenticationResult: { IdToken: 'test-id-token', ExpiresIn: 3600 },
      }),
    }),
  );
  await page.goto('/admin/events');
  await expect(
    page.getByRole('heading', { name: 'Iniciar sesión.' }),
  ).toBeVisible();
  await page.getByLabel('Usuario').fill('organizer');
  await page.getByLabel('Contraseña').fill('password');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(
    page.getByRole('heading', { name: 'Tus eventos' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(
    page.getByRole('heading', { name: 'Iniciar sesión.' }),
  ).toBeVisible();
});

test('renders a private gallery from a simulated token', async ({ page }) => {
  await page.goto('/gallery?token=demo-gallery');
  await expect(
    page.getByRole('heading', { name: /Findly Demo Night/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Fotografía del evento' }),
  ).toHaveCount(2);
});

test('shows new matches when an initially empty gallery refreshes', async ({
  page,
}) => {
  let reads = 0;
  await page.route(`${API}/gallery?**`, (route) => {
    reads += 1;
    return route.fulfill({
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        eventId: 'event-synthetic',
        eventName: 'Synthetic event',
        registrationId: 'registration-synthetic',
        expiresAt: '2099-01-01T00:00:00.000Z',
        photos:
          reads === 1
            ? []
            : [
                {
                  photoId: 'photo-synthetic',
                  url: `${API}/photos/synthetic.jpg`,
                  matchedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
      }),
    });
  });
  await page.clock.install();
  await page.goto('/gallery?token=synthetic-refresh-token');
  await expect(
    page.getByRole('heading', { name: 'Aún no hay fotos.' }),
  ).toBeVisible();
  await page.clock.fastForward(4 * 60 * 1000);
  await expect(
    page.getByRole('img', { name: 'Fotografía del evento' }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('heading', { name: 'Aún no hay fotos.' }),
  ).toHaveCount(0);
});

test('requires email before requesting a selfie upload', async ({ page }) => {
  let uploads = 0;
  await page.route(`${API}/events/demo-2026/registrations`, (route) => {
    uploads++;
    return route.fulfill({ status: 500 });
  });
  await page.goto('/?event=demo-2026');
  await page.getByLabel(/tratamiento biométrico/).check();
  await page.getByLabel(/términos de privacidad/).check();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'selfie.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('synthetic'),
  });
  await page.getByRole('button', { name: 'Enviar mi selfie' }).click();
  await expect(page.getByText('Introduce tu email.')).toBeVisible();
  expect(uploads).toBe(0);
});

test('admin confirms gallery email, retries the same operation and intentionally resends', async ({
  page,
}) => {
  const operations: string[] = [];
  const status = (operationId: string, state: string) => ({
    operationId,
    status: state,
    accepted: 2,
    skipped: 1,
    missingEmail: 1,
    failed: 0,
    uncertain: 0,
    bounced: 0,
    complained: 0,
  });
  await page.route(`${API}/admin/**`, (route) => {
    const request = route.request();
    if (request.method() !== 'OPTIONS')
      expect(request.headers().authorization).toBe('Bearer test-id-token');
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, code = 200) =>
      route.fulfill({
        status: code,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(body),
      });
    if (request.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        },
      });
    if (path === '/admin/events')
      return json({
        events: [
          {
            eventId: 'synthetic-event',
            name: 'Evento sintético',
            date: '2030-01-01T12:00:00Z',
            createdAt: new Date().toISOString(),
            status: 'OPEN',
            retentionDays: 1,
          },
        ],
      });
    if (request.method() === 'POST') {
      const operationId = String(request.postDataJSON().operationId);
      operations.push(operationId);
      if (operations.length === 1) return json({ code: 'RETRY' }, 503);
      return json(status(operationId, 'RUNNING'), 202);
    }
    return json(status(path.split('/').at(-1) ?? '', 'COMPLETED'));
  });
  await page.route('https://cognito-idp.eu-west-1.amazonaws.com/', (route) =>
    route.fulfill({
      contentType: 'application/x-amz-json-1.1',
      body: JSON.stringify({
        AuthenticationResult: { IdToken: 'test-id-token', ExpiresIn: 3600 },
      }),
    }),
  );
  await page.goto('/admin/login');
  await page.getByLabel('Usuario').fill('organizer');
  await page.getByLabel('Contraseña').fill('synthetic-password');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page
    .getByRole('button', { name: 'Enviar galerías', exact: true })
    .click();
  expect(operations).toHaveLength(0);
  await page.getByRole('button', { name: 'Confirmar envío' }).click();
  await expect(
    page.getByText(/No se pudo confirmar la solicitud/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reintentar solicitud' }).click();
  await page.getByRole('button', { name: 'Confirmar envío' }).click();
  await expect(page.getByText('Envío finalizado')).toBeVisible();
  expect(operations[0]).toBe(operations[1]);
  await page
    .getByRole('button', { name: 'Enviar galerías', exact: true })
    .click();
  await page.getByRole('button', { name: 'Confirmar envío' }).click();
  await expect.poll(() => operations.length).toBe(3);
  expect(operations[2]).not.toBe(operations[1]);
});
