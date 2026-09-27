import { fuse } from '@lit-core/css-fuse';
import { createIsolatedToolPlugin, normalizeInclude } from './base.js';

/**
 * Tool definition for @lit-core/css-fuse
 * @type {import('../types.js').BenchmarkTool}
 */
export const cssFuseTool = {
  id: 'css-fuse',
  name: 'css-fuse (CSS AST deduplication)',
  description: 'Cross-component CSS AST deduplication into constructable stylesheets',
  enabled: true,

  /**
   * Return Vite plugin(s) to test cssFuse in isolation.
   * @param {import('../types.js').SuiteContext} suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(suite) {
    return createIsolatedToolPlugin('cssFuse', {
      include: normalizeInclude(suite.includePattern),
      exclude: [],
      threshold: 2,
      applyInDev: true,
    });
  },

  /**
   * Optional diagnostics extraction for cssFuse
   * @param {import('../types.js').SuiteContext} suite
   */
  async getDiagnostics(suite) {
    const include = normalizeInclude(suite.includePattern);
    if (!include) return null;

    try {
      const res = fuse({
        include,
        exclude: [],
        threshold: 2,
        outputDir: '.fused',
        write: false,
        virtualImports: true,
      });

      return {
        rulesScanned: res.stats?.totalRules ?? 0,
        rulesDeduped: res.stats?.rulesDeduped ?? 0,
        fusedSheetsCreated: res.stats?.fusedSheetsCreated ?? 0,
        componentsRewritten: res.stats?.componentsRewritten ?? 0,
        bytesSavedEstimate: res.stats?.bytesSaved ?? 0,
      };
    } catch {
      return null;
    }
  },
};
