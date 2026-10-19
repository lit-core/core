import { createIsolatedToolPlugin, normalizeInclude } from './base.js';

/**
 * Tool definition for @lit-core/dom-paths
 * Ahead-of-time structural DOM path compiler eliminating TreeWalker traversal.
 * @type {import('../types.js').BenchmarkTool}
 */
export const domPathsTool = {
  id: 'dom-paths',
  name: 'dom-paths (AOT structural DOM path compiler)',
  description: 'Ahead-of-time DOM indexing eliminating runtime TreeWalker mounting traversal',
  enabled: true,

  /**
   * Return Vite plugin(s) to test domPaths in isolation.
   * @param {import('../types.js').SuiteContext} suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(suite) {
    const include = normalizeInclude(suite.includePattern);
    return createIsolatedToolPlugin('domPaths', {
      include,
      exclude: [],
      normalizeWhitespace: true,
    });
  },
};
