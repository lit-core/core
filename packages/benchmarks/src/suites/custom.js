import fs from 'node:fs';
import path from 'node:path';

/**
 * Factory for creating a custom benchmark suite pointing to any entrypoint and include glob.
 * @param {Object} options
 * @param {string} options.entry
 * @param {string} [options.include]
 * @param {string} [options.name]
 * @returns {import('../types.js').BenchmarkSuite}
 */
export function createCustomSuite({ entry, include, name = 'Custom Component Suite' }) {
  const resolvedEntry = path.resolve(process.cwd(), entry);

  return {
    id: 'custom',
    name,
    description: `Custom benchmark suite with entry ${entry}`,

    isAvailable() {
      return fs.existsSync(resolvedEntry);
    },

    async setup() {
      const resolvedInclude = include ? path.resolve(process.cwd(), include) : `${path.dirname(resolvedEntry)}/**/*.js`;

      return {
        id: 'custom',
        name,
        entryPath: resolvedEntry,
        includePattern: resolvedInclude,
        componentCount: 1,
      };
    },

    async cleanup() {
      // Nothing to cleanup for custom external files
    },
  };
}
