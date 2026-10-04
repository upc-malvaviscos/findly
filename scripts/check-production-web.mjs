import assert from 'node:assert/strict';

const origin = 'https://www.findly.barcelona';
for (const path of ['/', '/gallery']) {
  const response = await fetch(`${origin}${path}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, 'Production HTTPS route is unavailable');
  assert(
    response.headers.get('content-type')?.includes('text/html'),
    'Expected the deployed SPA',
  );
  const body = await response.text();
  assert(
    body.includes('<div id="root"></div>'),
    'Expected the Findly SPA entry point',
  );
}
console.log(
  'Production HTTPS and /gallery SPA routing verified. A real private gallery still requires authorized email receipt and opening.',
);
