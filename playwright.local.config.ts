import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'local-gallery.spec.ts',
  fullyParallel: true,
  retries: process.env.CI === 'true' ? 2 : 0,
  reporter:
    process.env.CI === 'true'
      ? [['github'], ['html', { open: 'never' }]]
      : 'list',
  globalSetup: './scripts/e2e-local-setup.mjs',
  globalTeardown: './scripts/e2e-local-teardown.mjs',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command:
      'VITE_API_BASE_URL=http://localhost:8787 npm run build:web && npm exec vite preview -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
