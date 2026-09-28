import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const api = `http://localhost:${process.env.LOCAL_API_PORT ?? '8787'}`;
test('Floci public registration capability and erasure use actual local handlers', async ({
  request,
}) => {
  const created = await request.post(`${api}/admin/events`, {
    headers: { authorization: 'Bearer synthetic-local-organizer' },
    data: {
      name: `Synthetic enrollment ${randomUUID()}`,
      date: '2030-01-01T12:00:00.000Z',
      retentionDays: 1,
    },
  });
  expect(created.status()).toBe(201);
  const { eventId } = await created.json();
  const listing = await request.get(`${api}/events`);
  expect(
    (await listing.json()).events.some(
      (event: { eventId: string }) => event.eventId === eventId,
    ),
  ).toBe(true);
  const denied = await request.post(`${api}/events/${eventId}/registrations`, {
    data: { consentBiometrics: false, consentTerms: true },
  });
  expect(denied.status()).toBe(400);
  const enrolled = await request.post(
    `${api}/events/${eventId}/registrations`,
    { data: { consentBiometrics: true, consentTerms: true } },
  );
  expect(enrolled.status()).toBe(201);
  const { registrationId, galleryToken, expiresInSeconds } =
    await enrolled.json();
  expect(expiresInSeconds).toBe(300);
  const headers = { 'X-Gallery-Token': galleryToken };
  const polling = await request.get(
    `${api}/registrations/${registrationId}/status`,
    { headers },
  );
  expect((await polling.json()).status).toBe('UPLOAD_PENDING');
  expect(
    (
      await request.get(`${api}/registrations/${registrationId}/status`)
    ).status(),
  ).toBe(400);
  const url = `${api}/gallery?token=${encodeURIComponent(galleryToken)}`;
  expect((await request.get(url)).status()).toBe(200);
  expect(
    (
      await request.delete(`${api}/registrations/${registrationId}`, {
        headers,
      })
    ).status(),
  ).toBe(204);
  expect((await request.get(url)).status()).toBe(404);
});
