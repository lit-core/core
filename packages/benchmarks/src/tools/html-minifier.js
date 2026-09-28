import { createIsolatedToolPlugin } from './base.js';

/**
 * Tool definition for @lit-core/html-minifier
 * Ahead-of-time (AOT) HTML & SVG tagged template minifier for Lit components via OXC.
 * Impact: -3.5% to -6.0% Minified JS / -2.0% to -3.5% Brotli across any component suite.
 * @type {import('../types.js').BenchmarkTool}
 */
export const htmlMinifierTool = {
  id: 'html-minifier',
  name: 'html-minifier (Lit HTML and SVG template minification)',
  description: 'Native Rust OXC AST minification of html`...` and svg`...` template literals (-3.5% to -6.0% minified JS)',
  enabled: true,

  /**
   * Return Vite plugin(s) to test htmlMinifier in isolation.
   * @param {import('../types.js').SuiteContext} suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(suite) {
    return createIsolatedToolPlugin('htmlMinifier', {
      include: suite?.includePattern ? [suite.includePattern].flat() : undefined,
      exclude: [],
    });
  },
};

export default htmlMinifierTool;
