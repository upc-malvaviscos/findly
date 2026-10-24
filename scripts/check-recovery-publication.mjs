import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import {
  recoveryOrigin,
  verifyRecoveryPredecessor,
} from './lib/recovery-publication.mjs';

const local = 'artifacts/organizer-recovery-web/dist';
const entry = readFileSync(`${local}/index.html`, 'utf8');
const script = entry.match(/type="module"[^>]*src="([^"]+)"/)?.[1];
assert(script?.startsWith('/assets/'), 'Expected a hashed application asset');
const fetchText = async (path) => {
  const response = await fetch(`${recoveryOrigin}${path}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    cache: 'no-store',
  });
  assert.equal(response.status, 200, 'Published route unavailable');
  return response.text();
};
if (process.argv.includes('--before')) {
  const currentEntry = await fetchText('/admin/login');
  const currentScript = currentEntry.match(
    /type="module"[^>]*src="([^"]+)"/,
  )?.[1];
  assert(
    currentScript?.startsWith('/assets/'),
    'Expected a deployed application asset',
  );
  verifyRecoveryPredecessor(
    await fetchText(currentScript),
    readFileSync(`${local}${script}`, 'utf8'),
  );
  console.log(
    'Current web matches the verified production predecessor or this limited release. Publication may proceed.',
  );
  process.exit(0);
}
for (const route of ['/', '/gallery', '/admin/login']) {
  const body = await fetchText(route);
  assert(body.includes(script), 'CDN is not serving this release');
}
assert.equal(
  await fetchText(script),
  readFileSync(`${local}${script}`, 'utf8'),
  'Application bytes differ at CDN',
);
assert.deepEqual(
  JSON.parse(await fetchText('/recovery-release.json')),
  JSON.parse(readFileSync(`${local}/recovery-release.json`, 'utf8')),
);

// Read-only UI acceptance: no authentication, recovery request or personal data.
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${recoveryOrigin}/admin/login`);
  await page
    .getByRole('button', { name: 'Ya tengo un código de recuperación' })
    .click();
  await page.getByLabel('Código de recuperación').waitFor({ state: 'visible' });
  await page
    .getByRole('button', { name: 'Volver al inicio de sesión' })
    .click();
  await page
    .getByRole('button', { name: 'Entrar', exact: true })
    .waitFor({ state: 'visible' });
} finally {
  await browser.close();
}
console.log(
  'CDN bytes, public routes and recovery form verified. Email receipt and subsequent login remain separate acceptance.',
);
