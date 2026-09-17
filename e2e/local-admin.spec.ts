import { expect, test } from '@playwright/test';

test('organizer creates, selects, and uploads a photo through Floci', async ({
  page,
}) => {
  await page.route('https://cognito-idp.eu-west-1.amazonaws.com/', (route) =>
    route.fulfill({
      contentType: 'application/x-amz-json-1.1',
      body: JSON.stringify({
        AuthenticationResult: {
          IdToken: 'local-organizer-token',
          ExpiresIn: 3600,
        },
      }),
    }),
  );
  await page.goto('/admin/events');
  await page.getByLabel('Usuario').fill('organizer');
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(
    page.getByRole('heading', { name: 'Tus eventos' }),
  ).toBeVisible();

  await page.getByLabel('Nombre del evento').fill('E2E Floci event');
  await page.getByLabel('Fecha').fill('2026-09-17T12:00');
  await page.getByLabel('Retención (días)').fill('7');
  await page.getByRole('button', { name: 'Crear evento' }).click();
  await expect(page.getByLabel('Evento seleccionado')).toHaveValue(/evt-/);

  await page.locator('input[type="file"]').setInputFiles({
    name: 'event-photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('synthetic event photo'),
  });
  await page.getByRole('button', { name: 'Subir fotografías' }).click();
  await expect(page.getByText('Progreso global: 100%')).toBeVisible();
});
