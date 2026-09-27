import { createIsolatedToolPlugin, normalizeInclude } from './base.js';

/**
 * Tool definition for @lit-core/event-hoist
 * Ahead-of-time ShadowRoot event delegation compiler pass and bundler optimization.
 * @type {import('../types.js').BenchmarkTool}
 */
export const eventHoistTool = {
  id: 'event-hoist',
  name: 'event-hoist (ahead-of-time ShadowRoot event delegation)',
  description: 'AOT compiler pass hoisting child element event listeners to a single delegated listener on ShadowRoot',
  enabled: true,

  /**
   * Return Vite plugin(s) to test eventHoist in isolation.
   * @param {import('../types.js').SuiteContext} suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(suite) {
    const include = normalizeInclude(suite.includePattern);
    return createIsolatedToolPlugin('eventHoist', {
      include,
      exclude: [],
    });
  },
};
