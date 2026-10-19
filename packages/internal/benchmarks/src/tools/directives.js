import { createIsolatedToolPlugin, normalizeInclude } from './base.js';

/**
 * Tool definition for @lit-core/directives
 * Ahead-of-time Lit directive lowering compiler.
 * @type {import('../types.js').BenchmarkTool}
 */
export const directivesTool = {
  id: 'directives',
  name: 'directives (AOT built-in Lit directive lowering)',
  description: 'Ahead-of-time compiler lowering built-in Lit directives into primitive expressions and pruning runtime imports',
  enabled: true,

  /**
   * Return Vite plugin(s) to test directives in isolation.
   * @param {import('../types.js').SuiteContext} suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(suite) {
    const include = normalizeInclude(suite.includePattern);
    return createIsolatedToolPlugin('directives', {
      include,
      exclude: [],
    });
  },
};
