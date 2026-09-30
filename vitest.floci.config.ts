import { defineConfig } from 'vitest/config';

// This suite may mutate its fixtures. Never fall back to the real AWS endpoint.
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.AWS_ENDPOINT_URL ?? '')) {
  throw new Error('Run this suite with npm run test:floci:integration.');
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
