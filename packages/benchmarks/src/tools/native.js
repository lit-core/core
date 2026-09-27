import { createIsolatedToolPlugin, normalizeInclude } from './base.js';

/**
 * Tool definition for @lit-core/native
 * Compiles Lit components into pure native Web Components ahead-of-time.
 * @type {import('../types.js').BenchmarkTool}
 */
export const nativeTool = {
  id: 'native',
  name: 'native (AOT vanilla Web Component compiler)',
  description: 'Ahead-of-time vanilla Custom Element and micro-runtime compiler eliminating Lit runtime dependencies',
  enabled: true,

  /**
   * Return Vite plugin(s) to test native in isolation.
   * @param {import('../types.js').SuiteContext} suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(suite) {
    return createIsolatedToolPlugin('native', {
      include: normalizeInclude(suite.includePattern),
      exclude: [],
    });
  },
};
