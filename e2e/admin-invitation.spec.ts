import { test, expect } from '@playwright/test';

test('invited organizer chooses a permanent password and enters administration', async ({
  page,
}) => {
  let completed = false;
  await page.route('https://api.findly.test/admin/events', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ events: [] }),
    }),
  );
  await page.route(
    'https://cognito-idp.eu-west-1.amazonaws.com/',
    async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS')
        return route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'POST,OPTIONS',
          },
        });
      const action = request.headers()['x-amz-target'];
      if (action?.endsWith('RespondToAuthChallenge')) {
        expect(request.postDataJSON()).toEqual({
          ClientId: 'test-client',
          ChallengeName: 'NEW_PASSWORD_REQUIRED',
          Session: 'synthetic-challenge',
          ChallengeResponses: {
            USERNAME: 'invited',
            NEW_PASSWORD: 'Permanent1!test',
          },
        });
        completed = true;
        return route.fulfill({
          contentType: 'application/x-amz-json-1.1',
          body: JSON.stringify({
            AuthenticationResult: {
              IdToken: 'synthetic-token',
              ExpiresIn: 3600,
            },
          }),
        });
      }
      return route.fulfill({
        contentType: 'application/x-amz-json-1.1',
        body: JSON.stringify({
          ChallengeName: 'NEW_PASSWORD_REQUIRED',
          Session: 'synthetic-challenge',
          ChallengeParameters: {
            USER_ID_FOR_SRP: 'invited',
            requiredAttributes: '[]',
          },
        }),
      });
    },
  );
  await page.goto('/admin');
  await page.getByLabel('Usuario').fill('invited');
  await page.getByLabel('Contraseña', { exact: true }).fill('Temporary1!test');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Elige tu contraseña.' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page
    .getByLabel('Nueva contraseña', { exact: true })
    .fill('Permanent1!test');
  await page.getByLabel('Repite la contraseña').fill('Permanent1!test');
  await page.getByRole('button', { name: 'Guardar y entrar' }).click();
  await expect(
    page.getByRole('heading', { name: 'Tus eventos' }),
  ).toBeVisible();
  expect(completed).toBe(true);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(
    page.getByRole('heading', { name: 'Iniciar sesión.' }),
  ).toBeVisible();
});
