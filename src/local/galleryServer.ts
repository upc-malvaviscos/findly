import { createServer } from 'node:http';
import { listPublicEvents, getPublicEvent } from '../lambdas/publicEvents';
import {
  createPublicRegistration,
  getPublicRegistrationStatus,
} from '../lambdas/publicEnrollment';
import { deleteRegistration } from '../lambdas/deleteRegistration';
import { gallery } from '../lambdas/gallery';
import {
  createAdminEvent,
  createPhotoUploads,
  listAdminEvents,
} from '../lambdas/adminEvents';

const port = Number(process.env.PORT ?? 8787);
const server = createServer(async (request, response) => {
  const url = new URL(
    request.url ?? '/',
    `http://${request.headers.host ?? 'localhost'}`,
  );
  if (request.method === 'OPTIONS') {
    response
      .writeHead(204, {
        'access-control-allow-origin': process.env.CORS_ORIGIN ?? '*',
        'access-control-allow-headers':
          'content-type, authorization, x-gallery-token',
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
      })
      .end();
    return;
  }
  if (request.method === 'GET' && url.pathname === '/gallery') {
    const result = await gallery({
      queryStringParameters: {
        token: url.searchParams.get('token') ?? undefined,
      },
    });
    response.writeHead(result.statusCode, result.headers).end(result.body);
    return;
  }
  const erasureMatch = url.pathname.match(/^\/registrations\/([^/]+)$/);
  if (request.method === 'DELETE' && erasureMatch) {
    try {
      const result = await deleteRegistration({
        pathParameters: { registrationId: decodeURIComponent(erasureMatch[1]) },
        headers: {
          'x-gallery-token':
            typeof request.headers['x-gallery-token'] === 'string'
              ? request.headers['x-gallery-token']
              : undefined,
        },
      });
      response
        .writeHead(result.statusCode, {
          ...result.headers,
          'access-control-allow-origin': process.env.CORS_ORIGIN ?? '*',
        })
        .end(result.body);
    } catch {
      response
        .writeHead(500, { 'content-type': 'application/json' })
        .end(JSON.stringify({ code: 'ERASURE_FAILED' }));
    }
    return;
  }
  const publicEventMatch = url.pathname.match(/^\/events\/([^/]+)$/);
  const registrationMatch = url.pathname.match(
    /^\/events\/([^/]+)\/registrations$/,
  );
  const statusMatch = url.pathname.match(/^\/registrations\/([^/]+)\/status$/);
  if (
    (request.method === 'GET' &&
      (url.pathname === '/events' || publicEventMatch || statusMatch)) ||
    (request.method === 'POST' && registrationMatch)
  ) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    const result = statusMatch
      ? await getPublicRegistrationStatus({
          pathParameters: {
            registrationId: decodeURIComponent(statusMatch[1]),
          },
          headers: {
            'x-gallery-token':
              typeof request.headers['x-gallery-token'] === 'string'
                ? request.headers['x-gallery-token']
                : undefined,
          },
        })
      : registrationMatch
        ? await createPublicRegistration({
            body,
            pathParameters: {
              eventId: decodeURIComponent(registrationMatch[1]),
            },
          })
        : publicEventMatch
          ? await getPublicEvent({
              pathParameters: {
                eventId: decodeURIComponent(publicEventMatch[1]),
              },
            })
          : await listPublicEvents();
    const publicUrl = process.env.FLOCI_PUBLIC_URL;
    response
      .writeHead(result.statusCode, {
        ...result.headers,
        'access-control-allow-origin': process.env.CORS_ORIGIN ?? '*',
      })
      .end(
        publicUrl
          ? result.body.replaceAll('http://floci:4566', publicUrl)
          : result.body,
      );
    return;
  }
  if (!request.headers.authorization?.startsWith('Bearer ')) {
    response
      .writeHead(401, { 'content-type': 'application/json' })
      .end(JSON.stringify({ code: 'UNAUTHORIZED' }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body =
    chunks.length === 0 ? undefined : Buffer.concat(chunks).toString();
  if (request.method === 'GET' && url.pathname === '/admin/events') {
    const result = await listAdminEvents();
    response.writeHead(result.statusCode, result.headers).end(result.body);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/admin/events') {
    const result = await createAdminEvent({ body });
    response.writeHead(result.statusCode, result.headers).end(result.body);
    return;
  }
  const uploadMatch = url.pathname.match(
    /^\/admin\/events\/([^/]+)\/photos\/uploads$/,
  );
  if (request.method === 'POST' && uploadMatch) {
    const result = await createPhotoUploads({
      body,
      pathParameters: { eventId: decodeURIComponent(uploadMatch[1]) },
    });
    const publicUrl = process.env.FLOCI_PUBLIC_URL;
    const responseBody = publicUrl
      ? result.body.replaceAll('http://floci:4566', publicUrl)
      : result.body;
    response.writeHead(result.statusCode, result.headers).end(responseBody);
    return;
  }
  {
    response.writeHead(404).end();
  }
});

server.listen(port, () =>
  console.log(`Findly local API listening on http://localhost:${port}`),
);
