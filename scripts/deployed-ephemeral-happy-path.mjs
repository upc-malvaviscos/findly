const apiEndpoint = process.env.EPHEMERAL_API_ENDPOINT?.replace(/\/$/, '');
const idToken = process.env.EPHEMERAL_ID_TOKEN;

if (!apiEndpoint || !idToken) {
  throw new Error(
    'EPHEMERAL_API_ENDPOINT and EPHEMERAL_ID_TOKEN are required for the deployed happy path.',
  );
}

async function api(path, init = {}) {
  const response = await fetch(`${apiEndpoint}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${idToken}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Deployed API ${path} returned ${response.status}.`);
  }
  return response.json();
}

const initialEvents = await api('/admin/events');
if (!Array.isArray(initialEvents.events)) {
  throw new Error('The deployed event listing did not return an events array.');
}

const created = await api('/admin/events', {
  method: 'POST',
  body: JSON.stringify({
    name: `CI ephemeral event ${process.env.GITHUB_RUN_ID ?? 'local'}`,
    date: '2030-01-01T12:00:00.000Z',
    retentionDays: 1,
  }),
});
if (
  typeof created.eventId !== 'string' ||
  !created.eventId.startsWith('evt-')
) {
  throw new Error('The deployed API did not return an event identifier.');
}

const selectedEvents = await api('/admin/events');
if (!selectedEvents.events.some((event) => event.eventId === created.eventId)) {
  throw new Error(
    'The created event cannot be selected from the deployed listing.',
  );
}

const uploadRequest = await api(
  `/admin/events/${encodeURIComponent(created.eventId)}/photos/uploads`,
  {
    method: 'POST',
    body: JSON.stringify({
      files: [
        { fileName: 'synthetic-ci-photo.jpg', contentType: 'image/jpeg' },
      ],
    }),
  },
);
const uploadUrl = uploadRequest.uploads?.[0]?.uploadUrl;
if (typeof uploadUrl !== 'string') {
  throw new Error(
    'The deployed API did not return a presigned JPEG upload URL.',
  );
}

const upload = await fetch(uploadUrl, {
  method: 'PUT',
  headers: { 'content-type': 'image/jpeg' },
  // A minimal synthetic JPEG payload. No personal or biometric image is used.
  body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
});
if (!upload.ok) {
  throw new Error(`The deployed S3 upload returned ${upload.status}.`);
}

console.log(
  'Deployed AWS organizer happy path passed: authenticated, created and selected an event, and uploaded a synthetic JPEG.',
);
