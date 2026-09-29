import path from 'node:path';
import { createComponentSuite } from './base.js';
import { getCanonicalSuiteConfig } from './canonical-components.js';

/**
 * IBM Carbon Design System (@carbon/web-components) benchmark suite definition.
 * 20 handpicked canonical enterprise UI components built on Lit.
 * @type {import('../types.js').BenchmarkSuite}
 */
export const carbonSuite = createComponentSuite({
  id: 'carbon',
  name: 'Carbon Web Components (@carbon/web-components)',
  description: 'IBM Carbon Design System Web Components built on Lit (20 Canonical Components)',
  packageName: '@carbon/web-components',
  entryFileName: '.carbon-entry.js',
  resolveConfig(carbonDir) {
    const { entryContent, componentCount, components } = getCanonicalSuiteConfig('carbon');
    const includePattern = path.join(carbonDir, 'es/**/*.js');

    return {
      entryContent,
      componentCount,
      includePattern,
      metadata: { carbonDir, components },
    };
  },
});
