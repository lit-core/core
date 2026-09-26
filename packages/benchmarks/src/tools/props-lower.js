import { lit } from '@lit-core/vite-plugin';

/**
 * Tool definition for @lit-core/props-lower
 * Lowers Lit decorators and reactive properties to static properties ahead-of-time (AOT).
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
    const include = Array.isArray(suite.includePattern) ? suite.includePattern : suite.includePattern ? [suite.includePattern] : undefined;

    return lit({
      cssFuse: false,
      propsLower: {
        include,
        exclude: [],
      },
    });
  },
};
