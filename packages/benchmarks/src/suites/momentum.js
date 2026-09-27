import path from 'node:path';
import { createComponentSuite, scanComponentEntries } from './base.js';

/**
 * Momentum Design (@momentum-design/components) benchmark suite definition.
 * Cisco Momentum Design System web components built on Lit.
 * @type {import('../types.js').BenchmarkSuite}
 */
export const momentumSuite = createComponentSuite({
  id: 'momentum',
  name: 'Momentum Design (@momentum-design/components)',
  description: 'Cisco Momentum Design System Web Components built on Lit (Full Suite)',
  packageName: '@momentum-design/components',
  entryFileName: '.momentum-entry.js',
  resolveConfig(momDir) {
    const compBaseDir = path.join(momDir, 'dist/components');
    const components = scanComponentEntries(compBaseDir, (_name, dir) => path.join(dir, 'index.js'));
    const entryContent = "import '@momentum-design/components';\n";
    const includePattern = path.join(momDir, 'dist/**/*.js');

    return {
      entryContent,
      componentCount: components.length,
      includePattern,
      metadata: { momDir, components: components.map((c) => c.name) },
    };
  },
});
