import { lit } from '@lit-core/vite-plugin';

/**
 * Tool definition for @lit-core/html-aot
 * Ahead-of-time (AOT) template compilation for Lit components.
 * Pre-computes parts and skips runtime parse and prepare phases.
 */
export const htmlAotTool = {
  id: 'html-aot',
  name: 'htmlAot (Ahead-of-time Lit template compilation)',
  description: 'AOT compiles Lit HTML templates into pre-parsed template objects, eliminating runtime prepare overhead',
  enabled: true,

  /**
   * Return Vite plugin(s) to test htmlAot in isolation.
   * @param {import('../types.js').SuiteContext} _suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(_suite) {
    return lit({
      cssFuse: false,
      propsLower: false,
      cssMinifier: false,
      htmlMinifier: false,
      htmlFuse: false,
      htmlAot: {
        exclude: [],
      },
    });
  },
};

export default htmlAotTool;
