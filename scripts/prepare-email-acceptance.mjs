import assert from 'node:assert/strict';
import { realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
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
// path.relative starts with ".." when `parent` is outside `repository`, is
// itself absolute when they are on different Windows drives (also outside),
// and is "" or a bare relative path when `parent` is inside or equal to it.
const relativeToRepository = relative(repository, parent);
const isOutsideRepository =
  relativeToRepository === '..' ||
  relativeToRepository.startsWith(`..${sep}`) ||
  isAbsolute(relativeToRepository);
assert(isOutsideRepository, 'Keep capabilities outside the repository');
writeFileSync(
  join(parent, basename(destination)),
  JSON.stringify(createEmailAcceptanceManifest(), null, 2),
  { mode: 0o600, flag: 'wx' },
);
console.log(
  'Private acceptance manifest created with mode 0600; contents are never printed.',
);
