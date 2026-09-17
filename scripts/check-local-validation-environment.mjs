import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const requireE2e = process.argv.includes('--e2e');
const failures = [];

function command(name, args, installation) {
  const result = spawnSync(name, args, { encoding: 'utf8' });
  if (result.status === 0) return;
  failures.push(`${name} is unavailable. Install it with: ${installation}`);
}

const expectedNode = readFileSync('.nvmrc', 'utf8').trim();
if (process.versions.node.split('.')[0] !== expectedNode) {
  failures.push(
    `Node ${expectedNode}.x is required; found ${process.versions.node}. Install with: nvm install ${expectedNode} && nvm use ${expectedNode}`,
  );
}

const npmVersion = spawnSync('npm', ['--version'], { encoding: 'utf8' });
if (npmVersion.status !== 0 || Number.parseInt(npmVersion.stdout, 10) < 11) {
  failures.push(
    'npm 11+ is required. Install Node from .nvmrc, then run: npm ci',
  );
}

for (const binary of [
  'eslint',
  'prettier',
  'markdownlint-cli2',
  'github-actionlint',
  'tsc',
  'vitest',
  'vite',
  'esbuild',
  'playwright',
]) {
  if (!existsSync(`node_modules/.bin/${binary}`)) {
    failures.push(
      `${binary} is missing from node_modules. Install the lockfile with: npm ci`,
    );
  }
}

command('terraform', ['version'], 'brew install hashicorp/tap/terraform');
command('tflint', ['--version'], 'brew install tflint');

if (requireE2e) {
  command(
    'docker',
    ['compose', 'version'],
    'install Docker Desktop, then start it',
  );
  command(
    'npm',
    ['exec', '--', 'playwright', 'install', '--list'],
    'npm exec -- playwright install --with-deps',
  );
}

if (failures.length > 0) {
  console.error('Local validation environment is not ready:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    requireE2e
      ? 'Local validation and E2E environment is ready.'
      : 'Local validation environment is ready.',
  );
}
