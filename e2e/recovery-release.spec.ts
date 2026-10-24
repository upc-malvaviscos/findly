import { expect, test } from '@playwright/test';

test('limited release keeps gallery email and does not introduce pending lifecycle controls', async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route('https://api.findly.test/admin/**', (route) => {
    requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        events: [
          {
            eventId: 'synthetic',
            name: 'Synthetic event',
            date: '2030-01-01T12:00:00Z',
            retentionDays: 1,
            status: 'OPEN',
            createdAt: '2030-01-01T12:00:00Z',
          },
        ],
      }),
    });
  });
  await page.route('https://cognito-idp.eu-west-1.amazonaws.com/', (route) =>
    route.fulfill({
      contentType: 'application/x-amz-json-1.1',
      body: JSON.stringify({
        AuthenticationResult: { IdToken: 'synthetic-token', ExpiresIn: 3600 },
      }),
    }),
  );
  await page.goto('/admin/login');
  await expect(
    page.getByRole('button', { name: 'Ya tengo un código de recuperación' }),
  ).toBeVisible();
  await page.getByLabel('Usuario').fill('synthetic');
  await page
    .getByLabel('Contraseña', { exact: true })
    .fill('Synthetic1!password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Tus eventos' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Enviar galerías', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Editar evento' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Eliminar evento' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: /Fotografías del evento/ }),
  ).toHaveCount(0);
  expect(requests).toEqual(['/admin/events']);
});
