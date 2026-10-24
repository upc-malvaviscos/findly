import { defineConfig, devices } from '@playwright/test';

const port = process.env.RECOVERY_WEB_PORT ?? '4175';
export default defineConfig({
  testDir: './e2e',
  testMatch: [
    'admin-invitation.spec.ts',
    'password-recovery.spec.ts',
    'recovery-release.spec.ts',
  ],
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'off' },
  webServer: {
    command: `VITE_FINDLY_EXECUTION_MODE=aws VITE_GALLERY_EMAIL_ENABLED=true VITE_API_BASE_URL=https://api.findly.test VITE_COGNITO_USER_POOL_ID=eu-west-1_test VITE_COGNITO_CLIENT_ID=test-client VITE_COGNITO_REGION=eu-west-1 npm run build:recovery-web && npm exec vite preview -- --outDir artifacts/organizer-recovery-web/dist --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
