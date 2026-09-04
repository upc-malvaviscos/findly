import { createServer } from 'node:http';
import { gallery } from '../lambdas/gallery';

const port = Number(process.env.PORT ?? 8787);
const server = createServer(async (request, response) => {
  const url = new URL(
    request.url ?? '/',
    `http://${request.headers.host ?? 'localhost'}`,
  );
  if (request.method !== 'GET' || url.pathname !== '/gallery') {
    response.writeHead(404).end();
    return;
  }
  const result = await gallery({
    queryStringParameters: {
      token: url.searchParams.get('token') ?? undefined,
    },
  });
  response.writeHead(result.statusCode, result.headers).end(result.body);
});

server.listen(port, () =>
  console.log(`Findly local API listening on http://localhost:${port}`),
);
