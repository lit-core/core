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
   * @param {import('../types.js').SuiteContext} _suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(_suite) {
    return lit({
      cssFuse: false,
      propsLower: true,
    });
  },
};
