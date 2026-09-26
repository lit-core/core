import { fuse } from '@lit-core/css-fuse';
import lit from '@lit-core/vite-plugin';

/**
 * Tool definition for @lit-core/css-fuse
 */
export const cssFuseTool = {
  id: 'css-fuse',
  name: 'cssFuse (CSS AST Deduplication)',
  description: 'Cross-component CSS AST deduplication into constructable stylesheets',
  enabled: true,

  /**
   * Return Vite plugin(s) to test cssFuse in isolation.
   * @param {import('../types.js').SuiteContext} suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(suite) {
    const include = Array.isArray(suite.includePattern) ? suite.includePattern : suite.includePattern ? [suite.includePattern] : undefined;

    return lit({
      cssFuse: {
        include,
        exclude: [],
        threshold: 2,
        applyInDev: true,
      },
    });
  },

  /**
   * Optional diagnostics extraction for cssFuse
   * @param {import('../types.js').SuiteContext} suite
   */
  async getDiagnostics(suite) {
    if (!suite.includePattern) return null;
    const include = Array.isArray(suite.includePattern) ? suite.includePattern : [suite.includePattern];

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
