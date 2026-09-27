import path from 'node:path';
import { createComponentSuite, scanComponentEntries } from './base.js';

/**
 * Web Awesome benchmark suite definition.
 * Tests full-suite bundling of 70+ components from @awesome.me/webawesome.
 * @type {import('../types.js').BenchmarkSuite}
 */
export const webAwesomeSuite = createComponentSuite({
  id: 'webawesome',
  name: 'Web Awesome (Full Component Suite)',
  description: '70+ production web components with shared styling and chunks',
  packageName: '@awesome.me/webawesome',
  entryFileName: '.webawesome-entry.js',
  resolveConfig(compDirRoot) {
    const compDir = path.join(compDirRoot, 'dist/components');
    const components = scanComponentEntries(compDir, (name, dir) => path.join(dir, `${name}.js`));
    const entryContent = components.map((c) => `import '@awesome.me/webawesome/dist/components/${c.name}/${c.name}.js';`).join('\n');
    const includePattern = path.join(compDirRoot, 'dist/**/*.js');

    return {
      entryContent,
      componentCount: components.length,
      includePattern,
      metadata: { compDir, components: components.map((c) => c.name) },
    };
  },
});
