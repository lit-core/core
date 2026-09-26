import { lit } from '@lit-core/vite-plugin';

/**
 * Tool definition for @lit-core/html-minifier
 * Ahead-of-time (AOT) HTML & SVG tagged template minifier for Lit components via OXC.
 * Impact: -3.5% to -6.0% Minified JS / -2.0% to -3.5% Brotli across any component suite.
 */
export const htmlMinifierTool = {
  id: 'html-minifier',
  name: 'htmlMinifier (Lit HTML & SVG Template Minification)',
  description: 'Native Rust OXC AST minification of html`...` and svg`...` template literals (-3.5% to -6.0% minified JS)',
  enabled: true,

  /**
   * Return Vite plugin(s) to test htmlMinifier in isolation.
   * @param {import('../types.js').SuiteContext} _suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(_suite) {
    return lit({
      cssFuse: false,
      propsLower: false,
      htmlMinifier: {
        exclude: [],
      },
    });
  },
};
export default htmlMinifierTool;
