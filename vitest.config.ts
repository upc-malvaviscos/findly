import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  plugins: [react()],
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    projects: [
      {
        test: {
          environment: 'jsdom',
          include: ['tests/web/**/*.test.tsx'],
          setupFiles: ['tests/web/setup.ts'],
          name: 'web',
        },
      },
      {
        test: {
          environment: 'node',
          include: ['tests/lambdas/**/*.test.ts'],
          name: 'lambdas',
        },
      },
    ],
  },
});
