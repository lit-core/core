import path from 'node:path';
import { createComponentSuite } from './base.js';
import { getCanonicalSuiteConfig } from './canonical-components.js';

/**
 * Web Awesome benchmark suite definition.
 * 20 handpicked canonical enterprise UI components built on Lit.
 * @type {import('../types.js').BenchmarkSuite}
 */
export const webAwesomeSuite = createComponentSuite({
  id: 'webawesome',
  name: 'Web Awesome (20 Canonical Components)',
  description: '20 handpicked production web components with shared styling and chunks',
  packageName: '@awesome.me/webawesome',
  entryFileName: '.webawesome-entry.js',
  resolveConfig(compDirRoot) {
    const { entryContent, componentCount, components } = getCanonicalSuiteConfig('webawesome');
    const includePattern = path.join(compDirRoot, 'dist/**/*.js');

    return {
      entryContent,
      componentCount,
      includePattern,
      metadata: { compDirRoot, components },
    };
  },
});
