import path from 'node:path';
import { createComponentSuite } from './base.js';

/**
 * Adobe Spectrum Design System (@spectrum-web-components) benchmark suite definition.
 * 50+ enterprise web components built on Lit.
 * @type {import('../types.js').BenchmarkSuite}
 */
export const spectrumSuite = createComponentSuite({
  id: 'spectrum',
  name: 'Spectrum Web Components (@spectrum-web-components)',
  description: 'Adobe Spectrum Design System Web Components built on Lit (Full Suite)',
  packageName: '@spectrum-web-components/bundle',
  entryFileName: '.spectrum-entry.js',
  resolveConfig(specDir) {
    const spectrumDir = path.dirname(specDir);
    return {
      entryContent: "import '@spectrum-web-components/bundle/elements.js';\n",
      componentCount: 52,
      includePattern: path.join(spectrumDir, '**/*.js'),
      metadata: { specDir, spectrumDir },
    };
  },
});
