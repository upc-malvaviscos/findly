import { expect, test } from '@playwright/test';

test('organizer completes emailed reset code and returns to login without a session', async ({
  page,
}) => {
  let confirmed = false;
  await page.route(
    'https://cognito-idp.eu-west-1.amazonaws.com/',
    async (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'POST,OPTIONS',
          },
        });
      expect(route.request().headers()['x-amz-target']).toBe(
        'AWSCognitoIdentityProviderService.ConfirmForgotPassword',
      );
      expect(route.request().postDataJSON()).toEqual({
        ClientId: 'test-client',
        Username: 'synthetic',
        ConfirmationCode: '123456',
        Password: 'Permanent1!test',
      });
      confirmed = true;
      return route.fulfill({
        contentType: 'application/x-amz-json-1.1',
        body: '{}',
      });
    },
  );
  await page.goto('/admin/login');
  await page
    .getByRole('button', { name: 'Ya tengo un código de recuperación' })
    .click();
  await page.getByLabel('Usuario').fill('synthetic');
  await page.getByLabel('Código de recuperación').fill('123456');
  await page
    .getByLabel('Nueva contraseña', { exact: true })
    .fill('Permanent1!test');
  await page.getByLabel('Repite la contraseña').fill('Permanent1!test');
  await page.getByRole('button', { name: 'Guardar nueva contraseña' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Contraseña actualizada',
  );
  expect(confirmed).toBe(true);
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
  await page
    .getByRole('button', { name: 'Volver al inicio de sesión' })
    .click();
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
});
