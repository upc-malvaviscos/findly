import { execFileSync } from 'node:child_process';

const compose = ['compose', '-f', 'docker-compose.yml'];
const localApiPort = process.env.LOCAL_API_PORT ?? '8787';
const run = (args) =>
  execFileSync('docker', [...compose, ...args], { stdio: 'inherit' });

const waitForApi = async () => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(
        `http://localhost:${localApiPort}/gallery?token=demo-gallery`,
      );
      if (response.ok) return;
    } catch {
      // The container is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Local gallery API did not become ready within 30 seconds.');
};

export default async function globalSetup() {
  if (process.env.E2E_LOCAL_ALREADY_RUNNING === 'true') return;
  try {
    run(['up', '-d', 'floci']);
    run(['run', '--rm', 'local-seed']);
    run(['up', '-d', 'local-api']);
    await waitForApi();
  } catch (error) {
    try {
      run(['down', '--volumes', '--remove-orphans']);
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}
