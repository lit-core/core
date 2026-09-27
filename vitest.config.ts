import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'packages/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/test_files/**', '**/*.test.js'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
