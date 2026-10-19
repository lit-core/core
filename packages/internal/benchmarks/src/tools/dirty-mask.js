import { createIsolatedToolPlugin, normalizeInclude } from './base.js';

/**
 * Tool definition for @lit-core/dirty-mask
 * Ahead-of-time property-to-part dependency bitmasking.
 * @type {import('../types.js').BenchmarkTool}
 */
export const dirtyMaskTool = {
  id: 'dirty-mask',
  name: 'dirty-mask (AOT reactive property bitmasking)',
  description: 'Ahead-of-time bitmask dependency compilation eliminating redundant template part checks',
  enabled: true,

  /**
   * Return Vite plugin(s) to test dirtyMask in isolation.
   * @param {import('../types.js').SuiteContext} suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(suite) {
    const include = normalizeInclude(suite.includePattern);
    return createIsolatedToolPlugin('dirtyMask', {
      include,
      exclude: [],
    });
  },
};
