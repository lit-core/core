import path from 'node:path';
import { createComponentSuite } from './base.js';
import { getCanonicalSuiteConfig } from './canonical-components.js';

/**
 * Momentum Design (@momentum-design/components) benchmark suite definition.
 * 20 handpicked canonical enterprise UI components built on Lit.
 * @type {import('../types.js').BenchmarkSuite}
 */
export const momentumSuite = createComponentSuite({
  id: 'momentum',
  name: 'Momentum Design (@momentum-design/components)',
  description: 'Cisco Momentum Design System Web Components built on Lit (20 Canonical Components)',
  packageName: '@momentum-design/components',
  entryFileName: '.momentum-entry.js',
  resolveConfig(momDir) {
    const { entryContent, componentCount, components } = getCanonicalSuiteConfig('momentum');

    return {
      entryContent,
      componentCount,
      includePattern: path.join(momDir, 'dist/**/*.js'),
      metadata: { momDir, components },
    };
  },
});
