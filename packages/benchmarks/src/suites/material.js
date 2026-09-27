import path from 'node:path';
import { createComponentSuite } from './base.js';

/**
 * Material Web (@material/web) benchmark suite definition.
 * Official Google Material Design 3 web components built on Lit.
 * @type {import('../types.js').BenchmarkSuite}
 */
export const materialSuite = createComponentSuite({
  id: 'material',
  name: 'Material Web (@material/web)',
  description: 'Google Material Design 3 Web Components built on Lit (Full Suite)',
  packageName: '@material/web',
  entryFileName: '.material-entry.js',
  resolveConfig(matDir) {
    return {
      entryContent: "import '@material/web/all.js';\n",
      componentCount: 28,
      includePattern: path.join(matDir, '**/*.js'),
      metadata: { matDir },
    };
  },
});
