import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assembleRecoverySource } from './lib/recovery-publication.mjs';

const root = process.cwd();
const parent = resolve(root, 'artifacts/organizer-recovery-web');
mkdirSync(parent, { recursive: true });
const workspace = mkdtempSync(join(tmpdir(), 'findly-recovery-build-'));
const source = resolve(workspace, 'source');
try {
  const manifest = assembleRecoverySource(root, source);
  const publicConfiguration = Object.fromEntries(
    [
      'VITE_FINDLY_EXECUTION_MODE',
      'VITE_API_BASE_URL',
      'VITE_COGNITO_USER_POOL_ID',
      'VITE_COGNITO_CLIENT_ID',
      'VITE_COGNITO_REGION',
      'VITE_GALLERY_EMAIL_ENABLED',
    ].map((name) => {
      assert(process.env[name], `Public build configuration required: ${name}`);
      return [name, process.env[name]];
    }),
  );
  assert.equal(publicConfiguration.VITE_FINDLY_EXECUTION_MODE, 'aws');
  assert.equal(publicConfiguration.VITE_GALLERY_EMAIL_ENABLED, 'true');
  // The root was installed with npm ci. Refuse dependency drift before using its
  // node_modules to compile the source pinned by the approved release manifest.
  const current = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8'),
  );
  const pinned = JSON.parse(
    readFileSync(resolve(source, 'package.json'), 'utf8'),
  );
  for (const key of ['dependencies', 'devDependencies', 'engines'])
    assert.deepEqual(
      current[key],
      pinned[key],
      'Review dependency drift before publishing',
    );
  assert(
    readFileSync(resolve(root, 'package-lock.json')).equals(
      readFileSync(resolve(source, 'package-lock.json')),
    ),
    'Review lockfile drift before publishing',
  );
  const buildEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('AWS_')),
  );
  execFileSync(
    resolve(root, 'node_modules/.bin/tsc'),
    ['--noEmit', '-p', resolve(source, 'tsconfig.web.json')],
    { cwd: source, stdio: 'inherit', env: buildEnv },
  );
  execFileSync(
    resolve(root, 'node_modules/.bin/vite'),
    ['build', '--outDir', resolve(parent, 'dist'), '--emptyOutDir'],
    {
      cwd: source,
      env: buildEnv,
      stdio: 'inherit',
    },
  );
  writeFileSync(
    resolve(parent, 'dist/recovery-release.json'),
    `${JSON.stringify({ ...manifest, publicConfiguration }, null, 2)}\n`,
  );
  console.log(
    'Recovery web built from the pinned production base and five authentication files. No infrastructure was changed.',
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
