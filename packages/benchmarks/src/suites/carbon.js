import path from 'node:path';
import { createComponentSuite, scanComponentEntries } from './base.js';

/**
 * IBM Carbon Design System (@carbon/web-components) benchmark suite definition.
 * 90+ production web components built on Lit.
 * @type {import('../types.js').BenchmarkSuite}
 */
export const carbonSuite = createComponentSuite({
  id: 'carbon',
  name: 'Carbon Web Components (@carbon/web-components)',
  description: 'IBM Carbon Design System Web Components built on Lit (Full Suite)',
  packageName: '@carbon/web-components',
  entryFileName: '.carbon-entry.js',
  resolveConfig(carbonDir) {
    const compBaseDir = path.join(carbonDir, 'es/components');
    const components = scanComponentEntries(compBaseDir, (_name, dir) => path.join(dir, 'index.js'));
    const entryContent = components.map((c) => `import '@carbon/web-components/es/components/${c.name}/index.js';`).join('\n');
    const includePattern = path.join(carbonDir, 'es/**/*.js');

    return {
      entryContent,
      componentCount: components.length,
      includePattern,
      metadata: { carbonDir, components: components.map((c) => c.name) },
    };
  },
});
