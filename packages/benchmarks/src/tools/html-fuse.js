import { fuse } from '@lit-core/html-fuse';
import lit from '@lit-core/vite-plugin';

/**
 * Tool definition for @lit-core/html-fuse
 */
export const htmlFuseTool = {
  id: 'html-fuse',
  name: 'htmlFuse (HTML/SVG AST Deduplication)',
  description: 'Cross-component static template and SVG fragment clustering',
  enabled: true,

  /**
   * Return Vite plugin(s) to test htmlFuse in isolation.
   * @param {import('../types.js').SuiteContext} suite
   * @returns {import('vite').Plugin[]}
   */
  getPlugins(suite) {
    const include = Array.isArray(suite.includePattern) ? suite.includePattern : suite.includePattern ? [suite.includePattern] : undefined;

    return lit({
      cssFuse: false,
      htmlFuse: {
        include,
        exclude: [],
        threshold: 2,
        minFragmentLength: 15,
      },
    });
  },

  /**
   * Optional diagnostics extraction for htmlFuse
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
        minFragmentLength: 15,
        outputDir: '.fused-html',
        write: false,
        virtualImports: true,
      });

      return {
        fragmentsScanned: res.stats?.fragmentsExtracted ?? 0,
        fragmentsDeduped: res.stats?.fragmentsDeduped ?? 0,
        fusedTemplatesCreated: res.stats?.fusedTemplatesCreated ?? 0,
        componentsRewritten: res.stats?.componentsRewritten ?? 0,
        bytesSavedEstimate: res.stats?.bytesSaved ?? 0,
      };
    } catch {
      return null;
    }
  },
};
