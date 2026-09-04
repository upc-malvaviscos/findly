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

test('renders the not-found state from the local API', async ({ page }) => {
  const response = await page.goto('/gallery?token=unknown-local-token');
  expect(response?.ok()).toBe(true);
  await expect(
    page.getByRole('heading', { name: 'Galería no encontrada.' }),
  ).toBeVisible();
});
