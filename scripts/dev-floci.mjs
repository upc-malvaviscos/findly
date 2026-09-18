import { spawn, spawnSync } from 'node:child_process';

const compose = (args) =>
  spawnSync('docker', ['compose', '-f', 'docker-compose.yml', ...args], {
    stdio: 'inherit',
    env: process.env,
  });
const run = (args) => {
  const result = compose(args);
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const localApiPort = process.env.LOCAL_API_PORT ?? '8787';
const webPort = process.env.WEB_PORT ?? '5173';

run(['up', '-d', 'floci']);
run(['run', '--rm', 'local-seed']);
run(['up', '-d', 'local-api']);

const vite = spawn(
  'npm',
  ['exec', 'vite', '--', '--host', '127.0.0.1', '--port', webPort],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_FINDLY_EXECUTION_MODE: 'floci',
      VITE_API_BASE_URL: `http://localhost:${localApiPort}`,
    },
  },
);
const stop = () => {
  vite.kill('SIGTERM');
  compose(['down', '--volumes', '--remove-orphans']);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
vite.on('exit', (code) => process.exit(code ?? 0));
