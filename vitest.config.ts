import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      {
        test: {
          name: 'container',
          include: ['tests/container/**/*.test.ts'],
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 90_000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          fileParallelism: false,
          testTimeout: 90_000,
          hookTimeout: 90_000,
        },
      },
    ],
  },
});
