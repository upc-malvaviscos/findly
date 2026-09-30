import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

// A dedicated project and ephemeral loopback port protect an active dev:floci session.
const project = `findly-selfie-tests-${randomUUID()}`;
const composeArgs = [
  'compose',
  '-p',
  project,
  '-f',
  'tests/integration/floci.compose.yml',
];
const compose = (args, capture = false) =>
  execFileSync('docker', [...composeArgs, ...args], {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    timeout: 120000,
  });
let testProcess;
let interrupted = false;
const stop = () => {
  interrupted = true;
  testProcess?.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

try {
  compose(['up', '-d', '--wait', '--wait-timeout', '60']);
  if (interrupted) throw new Error('Floci integration interrupted.');
  const address = compose(['port', 'floci', '4566'], true).trim();
  if (!/^127\.0\.0\.1:\d+$/.test(address))
    throw new Error('Unexpected Floci port binding.');
  const container = compose(['ps', '-q', 'floci'], true).trim();
  const image = execFileSync(
    'docker',
    ['inspect', '--format', '{{.Image}}', container],
    { encoding: 'utf8' },
  ).trim();
  console.log(
    `Integration uses ${image} at http://${address}; Rekognition is mocked.`,
  );
  const testEnv = { ...process.env };
  // A caller's AWS SSO profile must not override the synthetic Floci credentials.
  delete testEnv.AWS_PROFILE;
  delete testEnv.AWS_DEFAULT_PROFILE;
  const code = await new Promise((resolveExit, reject) => {
    testProcess = spawn(
      process.execPath,
      [
        resolve('node_modules/vitest/vitest.mjs'),
        'run',
        '--config',
        'vitest.floci.config.ts',
      ],
      {
        stdio: 'inherit',
        env: {
          ...testEnv,
          AWS_ENDPOINT_URL: `http://${address}`,
          AWS_ACCESS_KEY_ID: 'local',
          AWS_SECRET_ACCESS_KEY: 'local',
          AWS_SESSION_TOKEN: '',
          AWS_REGION: 'eu-west-1',
          AWS_DEFAULT_REGION: 'eu-west-1',
          AWS_EC2_METADATA_DISABLED: 'true',
        },
      },
    );
    testProcess.once('error', reject);
    testProcess.once('exit', (exitCode) => resolveExit(exitCode ?? 1));
  });
  process.exitCode = interrupted ? 1 : code;
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Floci integration failed.',
  );
  process.exitCode = 1;
} finally {
  try {
    // Only resources bearing this run's random Compose project are removed.
    compose(['down', '--volumes', '--remove-orphans']);
  } catch {
    console.error(`Could not clean up Compose project ${project}.`);
    process.exitCode = 1;
  }
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
