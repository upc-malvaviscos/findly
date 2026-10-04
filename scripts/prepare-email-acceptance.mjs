import assert from 'node:assert/strict';
import { realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmailAcceptanceManifest } from './lib/email-acceptance-manifest.mjs';

const destination = process.argv
  .find((arg) => arg.startsWith('--out='))
  ?.slice(6);
assert(
  destination && isAbsolute(destination),
  'Use --out= with a private absolute path outside the repository',
);
const repository = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const parent = realpathSync(dirname(destination));
assert(
  parent !== repository && !parent.startsWith(`${repository}/`),
  'Keep capabilities outside the repository',
);
writeFileSync(
  join(parent, destination.split('/').at(-1)),
  JSON.stringify(createEmailAcceptanceManifest(), null, 2),
  { mode: 0o600, flag: 'wx' },
);
console.log(
  'Private acceptance manifest created with mode 0600; contents are never printed.',
);
