import path from 'node:path';
import { createComponentSuite } from './base.js';
import { getCanonicalSuiteConfig } from './canonical-components.js';

/**
 * Adobe Spectrum Design System (@spectrum-web-components) benchmark suite definition.
 * 20 handpicked canonical enterprise UI components built on Lit.
 * @type {import('../types.js').BenchmarkSuite}
 */
export const spectrumSuite = createComponentSuite({
  id: 'spectrum',
  name: 'Spectrum Web Components (@spectrum-web-components)',
  description: 'Adobe Spectrum Design System Web Components built on Lit (20 Canonical Components)',
  packageName: '@spectrum-web-components/bundle',
  entryFileName: '.spectrum-entry.js',
  resolveConfig(specDir) {
    const spectrumDir = path.dirname(specDir);
    const { entryContent, componentCount, components } = getCanonicalSuiteConfig('spectrum');

    return {
      entryContent,
      componentCount,
      includePattern: [path.join(spectrumDir, '**/*.js'), '**/@spectrum-web-components*/**/*.js'],
      metadata: { specDir, spectrumDir, components },
    };
  },
});
