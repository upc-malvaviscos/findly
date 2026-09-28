// Reusable AWS smoke; all network calls execute in a real browser without routes.
// The caller owns event creation and cleanup of registrations, tokens and S3 keys.
export async function runPublicEnrollmentSmoke({
  page,
  apiEndpoint,
  eventId,
  onRegistration,
  syntheticJpeg,
  expectedStatus = 'FAILED',
}) {
  const base = apiEndpoint.replace(/\/$/, '');
  const request = async (path, init = {}) =>
    page.evaluate(
      async ({ url, init }) => {
        const response = await fetch(url, init);
        return { status: response.status, body: await response.json() };
      },
      { url: `${base}${path}`, init },
    );
  const listing = await request('/events');
  if (
    listing.status !== 200 ||
    !listing.body.events.some((event) => event.eventId === eventId)
  )
    throw new Error('PUBLIC_EVENT_LISTING_FAILED');
  const detail = await request(`/events/${encodeURIComponent(eventId)}`);
  if (detail.status !== 200 || detail.body.eventId !== eventId)
    throw new Error('PUBLIC_EVENT_DETAIL_FAILED');
  const denied = await request(
    `/events/${encodeURIComponent(eventId)}/registrations`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ consentBiometrics: false, consentTerms: true }),
    },
  );
  if (denied.status !== 400) throw new Error('CONSENT_NOT_ENFORCED');
  const registration = await request(
    `/events/${encodeURIComponent(eventId)}/registrations`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ consentBiometrics: true, consentTerms: true }),
    },
  );
  if (
    registration.status !== 201 ||
    registration.body.expiresInSeconds !== 300 ||
    !registration.body.galleryToken
  )
    throw new Error('PUBLIC_REGISTRATION_FAILED');
  const { registrationId, galleryToken, uploadUrl } = registration.body;
  // Register cleanup before upload or polling can fail; never print capabilities.
  await onRegistration({ eventId, registrationId, galleryToken });
  const unauthorized = await request(
    `/registrations/${encodeURIComponent(registrationId)}/status`,
  );
  if (unauthorized.status !== 400)
    throw new Error('POLLING_CAPABILITY_NOT_ENFORCED');
  const mismatched = await request(
    '/registrations/synthetic-wrong-registration/status',
    { headers: { 'X-Gallery-Token': galleryToken } },
  );
  if (mismatched.status !== 404) throw new Error('POLLING_ID_NOT_ENFORCED');
  const uploaded = await page.evaluate(
    async ({ uploadUrl, syntheticJpeg }) => {
      let blob;
      if (syntheticJpeg) {
        blob = new Blob(
          [Uint8Array.from(atob(syntheticJpeg), (char) => char.charCodeAt(0))],
          { type: 'image/jpeg' },
        );
      } else {
        const canvas = globalThis.document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('CANVAS_UNAVAILABLE');
        context.fillStyle = '#777777';
        context.fillRect(0, 0, 64, 64);
        blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg'),
        );
      }
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        body: blob,
      });
      return response.status;
    },
    { uploadUrl, syntheticJpeg },
  );
  if (uploaded !== 200) throw new Error('PUBLIC_SELFIE_UPLOAD_FAILED');
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const result = await request(
      `/registrations/${encodeURIComponent(registrationId)}/status`,
      { headers: { 'X-Gallery-Token': galleryToken } },
    );
    if (result.status !== 200) throw new Error('PUBLIC_POLLING_FAILED');
    if (result.body.status === 'ENROLLED' || result.body.status === 'FAILED') {
      if (result.body.status !== expectedStatus)
        throw new Error('UNEXPECTED_SELFIE_TERMINAL_STATUS');
      return {
        registrationId,
        terminalStatus: result.body.status,
        realBrowserUpload: true,
      };
    }
    await page.waitForTimeout(1500);
  }
  throw new Error('PUBLIC_SELFIE_POLLING_TIMEOUT');
}
