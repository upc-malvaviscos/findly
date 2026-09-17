import { expect, test } from '@playwright/test';

test('renders the private gallery from Floci', async ({ page }) => {
  const response = await page.goto('/gallery?token=demo-gallery');
  expect(response?.ok()).toBe(true);
  await expect(
    page.getByRole('heading', { name: /Findly Demo Night/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Fotografía del evento' }),
  ).toHaveCount(2);
});

test('shows the empty-gallery state from Floci', async ({ page }) => {
  await page.goto('/gallery?token=demo-gallery-empty');
  await expect(
    page.getByRole('heading', { name: 'Aún no hay fotos.' }),
  ).toBeVisible();
});

test('opens the download control for a Floci-signed photo', async ({
  page,
}) => {
  await page.goto('/gallery?token=demo-gallery');
  await page.getByRole('button', { name: 'Abrir fotografía' }).first().click();
  const download = page.getByRole('link', { name: 'Descargar' });
  await expect(download).toHaveAttribute('download');
  await expect(download).toHaveAttribute('href', /photos\/photo-1\.jpg/);
});

test('renders the not-found state from the local API', async ({ page }) => {
  const response = await page.goto('/gallery?token=unknown-local-token');
  expect(response?.ok()).toBe(true);
  await expect(
    page.getByRole('heading', { name: 'Galería no encontrada.' }),
  ).toBeVisible();
});

test('renders an expired-link state from the local API', async ({ page }) => {
  const response = await page.goto('/gallery?token=expired');
  expect(response?.ok()).toBe(true);
  await expect(
    page.getByRole('heading', { name: 'Enlace caducado.' }),
  ).toBeVisible();
});
