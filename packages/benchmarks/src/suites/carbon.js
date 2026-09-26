import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../..');

function findCarbonDir() {
  const possible = [path.join(rootDir, 'node_modules/@carbon/web-components'), path.resolve('node_modules/@carbon/web-components')];
  return possible.find((p) => fs.existsSync(p)) || null;
}

/**
 * IBM Carbon Design System (@carbon/web-components) benchmark suite definition.
 * 90+ production web components built on Lit.
 * @type {import('../types.js').BenchmarkSuite}
 */
export const carbonSuite = {
  id: 'carbon',
  name: 'Carbon Web Components (@carbon/web-components)',
  description: 'IBM Carbon Design System Web Components built on Lit (Full Suite)',

  isAvailable() {
    return findCarbonDir() !== null;
  },

  async setup() {
    const carbonDir = findCarbonDir();
    if (!carbonDir) {
      throw new Error('Carbon Web Components package not found in node_modules.');
    }

    const compBaseDir = path.join(carbonDir, 'es/components');
    const components = fs.readdirSync(compBaseDir).filter((name) => {
      const p = path.join(compBaseDir, name, 'index.js');
      return fs.existsSync(p);
    });

    const entryContent = components.map((name) => `import '@carbon/web-components/es/components/${name}/index.js';`).join('\n');

    const entryPath = path.join(__dirname, '.carbon-entry.js');
    fs.writeFileSync(entryPath, entryContent);

    const includePattern = path.join(carbonDir, 'es/**/*.js');

    return {
      id: 'carbon',
      name: `Carbon Web Components (${components.length} components)`,
      entryPath,
      includePattern,
      componentCount: components.length,
      metadata: { carbonDir, components },
    };
  },

  async cleanup() {
    const entryPath = path.join(__dirname, '.carbon-entry.js');
    if (fs.existsSync(entryPath)) {
      fs.rmSync(entryPath, { force: true });
    }
  },
};
