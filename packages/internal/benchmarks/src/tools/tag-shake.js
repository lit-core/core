import { createIsolatedToolPlugin, normalizeInclude } from './base.js';

/**
 * Tool definition for @lit-core/tag-shake
 * Ahead-of-time Web Component dead code elimination and registration tag shaking compiler.
 * @type {import('../types.js').BenchmarkTool}
 */
export const tagShakeTool = {
  id: 'tag-shake',
  name: 'tag-shake (AOT Web Component dead code elimination)',
  description: 'Ahead-of-time compiler scanning templates and pruning unreferenced custom element registrations and imports',
  enabled: true,

  /**
   * Return Vite plugin(s) to test tag-shake in isolation.
   * @param {import('../types.js').SuiteContext} suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(suite) {
    const include = normalizeInclude(suite.includePattern);
    const keepTags = suite.metadata?.components ? Object.values(suite.metadata.components).map((c) => c.tag) : [];

    return createIsolatedToolPlugin('tagShake', {
      include,
      exclude: [],
      keepTags,
    });
  },
};
