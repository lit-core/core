import { createIsolatedToolPlugin } from './base.js';

/**
 * Tool definition for @lit-core/html-aot
 * Ahead-of-time (AOT) template compilation for Lit components.
 * Pre-computes parts and skips runtime parse and prepare phases.
 * @type {import('../types.js').BenchmarkTool}
 */
export const htmlAotTool = {
  id: 'html-aot',
  name: 'html-aot (ahead-of-time Lit template compilation)',
  description: 'AOT compiles Lit HTML templates into pre-parsed template objects, eliminating runtime prepare overhead',
  enabled: true,

  /**
   * Return Vite plugin(s) to test htmlAot in isolation.
   * @param {import('../types.js').SuiteContext} _suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(_suite) {
    return createIsolatedToolPlugin('htmlAot', {
      exclude: [],
    });
  },
};

export default htmlAotTool;
