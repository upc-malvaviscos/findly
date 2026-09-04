import { expect, test } from '@playwright/test';

test('renders the public enrollment page', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.brand')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Encuentra tu momento.' }),
  ).toBeVisible();
});

test('completes the public selfie enrollment flow', async ({ page }) => {
  await page.goto('/?event=demo-2026');
  await page.getByLabel('Nombre completo').fill('Ada Lovelace');
  await page.getByLabel('Email para tu galería').fill('ada@example.com');
  await page.getByRole('checkbox').check();
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
