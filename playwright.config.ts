import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testIgnore: 'local-gallery.spec.ts',
  fullyParallel: true,
  retries: process.env.CI === 'true' ? 2 : 0,
  reporter:
    process.env.CI === 'true'
      ? [['github'], ['html', { open: 'never' }]]
      : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command:
      'VITE_COGNITO_USER_POOL_ID=eu-west-1_test VITE_COGNITO_CLIENT_ID=test-client VITE_COGNITO_REGION=eu-west-1 npm run build:web && npm exec vite preview -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
