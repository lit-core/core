import { createIsolatedToolPlugin, normalizeInclude } from './base.js';

/**
 * Tool definition for @lit-core/props-lower
 * Lowers Lit decorators and reactive properties to static properties ahead-of-time (AOT).
 * @type {import('../types.js').BenchmarkTool}
 */
export const propsLowerTool = {
  id: 'props-lower',
  name: 'propsLower (Lit Decorators & Properties AOT Lowering)',
  description: 'Native Rust AST lowering of Lit decorators (@customElement, @property, @state, @query) to static properties',
  enabled: true,

  /**
   * Return Vite plugin(s) to test propsLower in isolation.
   * @param {import('../types.js').SuiteContext} suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(suite) {
    return createIsolatedToolPlugin('propsLower', {
      include: normalizeInclude(suite.includePattern),
      exclude: [],
    });
  },
};
