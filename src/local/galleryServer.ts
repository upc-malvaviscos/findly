import { createServer } from 'node:http';
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
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
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
