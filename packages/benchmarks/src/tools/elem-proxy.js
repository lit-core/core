import { createIsolatedToolPlugin, normalizeInclude } from './base.js';

/**
 * Tool definition for @lit-core/elem-proxy
 * Replaces eager Custom Element registrations with lightweight proxy stubs.
 * @type {import('../types.js').BenchmarkTool}
 */
export const elemProxyTool = {
  id: 'elem-proxy',
  name: 'elem-proxy (deferred custom element proxy stubs)',
  description: 'AOT compiler transform replacing eager Custom Element registrations with lightweight proxy stubs',
  enabled: true,

  /**
   * Return Vite plugin(s) to test elemProxy in isolation.
   * @param {import('../types.js').SuiteContext} suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(suite) {
    const include = normalizeInclude(suite.includePattern);
    return createIsolatedToolPlugin('elemProxy', {
      include,
      exclude: [],
    });
  },
};
