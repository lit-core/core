import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: [path.resolve(import.meta.dirname, './test/setup.ts')],
  },
});
