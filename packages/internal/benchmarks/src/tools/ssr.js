import { createIsolatedToolPlugin, normalizeInclude } from './base.js';

/**
 * Tool definition for @lit-core/ssr
 * Ahead-of-time SSR engine emitting clean Declarative Shadow DOM with zero comment markers.
 * @type {import('../types.js').BenchmarkTool}
 */
export const ssrTool = {
  id: 'ssr',
  name: 'ssr (universal server rendering engine)',
  description: 'Ahead-of-time optimized SSR engine emitting clean Declarative Shadow DOM with zero comment markers',
  enabled: false,

  /**
   * Return Vite plugin(s) to test ssr in isolation.
   * @param {import('../types.js').SuiteContext} suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(suite) {
    const include = normalizeInclude(suite?.includePattern);
    return createIsolatedToolPlugin('ssr', {
      include,
      exclude: [],
      streaming: true,
    });
  },
};

export default ssrTool;
