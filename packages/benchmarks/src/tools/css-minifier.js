import { createIsolatedToolPlugin } from './base.js';

/**
 * Tool definition for @lit-core/css-minifier
 * Embedded CSS template minification via Lightning CSS.
 * @type {import('../types.js').BenchmarkTool}
 */
export const cssMinifierTool = {
  id: 'css-minifier',
  name: 'css-minifier (embedded CSS template minification)',
  description: 'Native Rust Lightning CSS minification of embedded css`...` tagged template literals',
  enabled: true,

  /**
   * Return Vite plugin(s) to test cssMinifier in isolation.
   * @param {import('../types.js').SuiteContext} _suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(suite) {
    return createIsolatedToolPlugin('cssMinifier', {
      include: suite?.includePattern ? [suite.includePattern].flat() : undefined,
      exclude: [],
    });
  },
};
