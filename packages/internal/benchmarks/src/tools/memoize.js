import { createIsolatedToolPlugin, normalizeInclude } from './base.js';

/**
 * Tool definition for @lit-core/memoize
 * Ahead-of-time reactive expression auto-memoization compiler.
 * @type {import('../types.js').BenchmarkTool}
 */
export const memoizeTool = {
  id: 'memoize',
  name: 'memoize (AOT reactive expression auto-memoization)',
  description: 'Ahead-of-time analysis auto-caching expensive render expressions and transformations',
  enabled: true,

  /**
   * Return Vite plugin(s) to test memoize in isolation.
   * @param {import('../types.js').SuiteContext} suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(suite) {
    const include = normalizeInclude(suite.includePattern);
    return createIsolatedToolPlugin('memoize', {
      include,
      exclude: [],
    });
  },
};
