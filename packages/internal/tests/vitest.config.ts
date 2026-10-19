import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { decorator: { legacy: true } },
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
