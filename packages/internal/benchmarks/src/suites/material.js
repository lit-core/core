import path from 'node:path';
import { createComponentSuite } from './base.js';
import { getCanonicalSuiteConfig } from './canonical-components.js';

/**
 * Material Web (@material/web) benchmark suite definition.
 * 20 handpicked canonical enterprise UI components built on Lit.
 * @type {import('../types.js').BenchmarkSuite}
 */
export const materialSuite = createComponentSuite({
  id: 'material',
  name: 'Material Web (@material/web)',
  description: 'Google Material Design 3 Web Components built on Lit (20 Canonical Components)',
  packageName: '@material/web',
  entryFileName: '.material-entry.js',
  resolveConfig(matDir) {
    const { entryContent, componentCount, components } = getCanonicalSuiteConfig('material');

    return {
      entryContent,
      componentCount,
      includePattern: path.join(matDir, '**/*.js'),
      metadata: { matDir, components },
    };
  },
});
