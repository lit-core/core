import { createIsolatedToolPlugin, normalizeInclude } from './base.js';

/**
 * Tool definition for @lit-core/resumable
 * Ahead-of-time SSR and interaction-driven runtime resumption.
 * @type {import('../types.js').BenchmarkTool}
 */
export const resumableTool = {
  id: 'resumable',
  name: 'resumable (AOT SSR and interaction-driven resumption)',
  description: 'Ahead-of-time compiler rewriting components for zero-JS boot and interaction resumption',
  enabled: true,

  /**
   * Return Vite plugin(s) to test resumable in isolation.
   * @param {import('../types.js').SuiteContext} suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(suite) {
    const include = normalizeInclude(suite.includePattern);
    return createIsolatedToolPlugin('resumable', {
      include,
      exclude: [],
      preloadOnHover: true,
      injectAdapter: true,
    });
  },
};
