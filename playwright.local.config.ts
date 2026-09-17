import { defineConfig, devices } from '@playwright/test';

const localApiPort = process.env.LOCAL_API_PORT ?? '8787';
const webPort = process.env.WEB_PORT ?? '4173';

export default defineConfig({
  testDir: './e2e',
  testMatch: /local-(gallery|admin)\.spec\.ts/,
  fullyParallel: true,
  retries: process.env.CI === 'true' ? 2 : 0,
  reporter:
    process.env.CI === 'true'
      ? [['github'], ['html', { open: 'never' }]]
      : 'list',
  globalSetup: './scripts/e2e-local-setup.mjs',
  globalTeardown: './scripts/e2e-local-teardown.mjs',
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `VITE_API_BASE_URL=http://localhost:${localApiPort} VITE_COGNITO_USER_POOL_ID=eu-west-1_local VITE_COGNITO_CLIENT_ID=local-client VITE_COGNITO_REGION=eu-west-1 npm run build:web && npm exec vite preview -- --host 127.0.0.1 --port ${webPort}`,
    url: `http://127.0.0.1:${webPort}`,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
