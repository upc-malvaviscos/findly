import { expect, test, type Page } from '@playwright/test';

const API = 'https://api.findly.test';
const UPLOAD_URL = 'https://s3.findly.test/selfies/reg-e2e';

/** HTTP mock that follows the real backend contract (spec 18); synthetic data only. */
async function mockBackend(page: Page) {
  let statusReads = 0;
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
          uploadUrl: UPLOAD_URL,
          expiresInSeconds: 300,
        },
        201,
      );
    }
    if (pathname === '/registrations/reg-e2e/status') {
      statusReads += 1;
      return json({
        registrationId: 'reg-e2e',
        status: statusReads >= 2 ? 'ENROLLED' : 'PROCESSING',
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
    return route.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
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
