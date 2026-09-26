import { lit } from '@lit-core/vite-plugin';

/**
 * Tool definition for @lit-core/css-minifier
 * Embedded CSS template minification via Lightning CSS.
 */
export const cssMinifierTool = {
  id: 'css-minifier',
  name: 'cssMinifier (Embedded CSS Template Minification)',
  description: 'Native Rust Lightning CSS minification of embedded css`...` tagged template literals',
  enabled: true,

  /**
   * Return Vite plugin(s) to test cssMinifier in isolation.
   * @param {import('../types.js').SuiteContext} _suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(_suite) {
    return lit({
      cssFuse: false,
      cssMinifier: {
        exclude: [],
      },
    });
  },
};
