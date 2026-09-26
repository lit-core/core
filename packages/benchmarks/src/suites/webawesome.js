import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../..');

/**
 * Locate @awesome.me/webawesome components directory
 * @returns {string | null}
 */
function findWebAwesomeDir() {
  const possiblePaths = [
    path.join(rootDir, 'node_modules/@awesome.me/webawesome/dist/components'),
    path.resolve('node_modules/@awesome.me/webawesome/dist/components'),
    path.resolve(__dirname, '../../node_modules/@awesome.me/webawesome/dist/components'),
  ];
  return possiblePaths.find((p) => fs.existsSync(p)) || null;
}

/**
 * Web Awesome benchmark suite definition.
 * Tests full-suite bundling of 70+ components from @awesome.me/webawesome.
 * @type {import('../types.js').BenchmarkSuite}
 */
export const webAwesomeSuite = {
  id: 'webawesome',
  name: 'Web Awesome (Full Component Suite)',
  description: '70+ production web components with shared styling and chunks',

  isAvailable() {
    return findWebAwesomeDir() !== null;
  },

  async setup() {
    const compDir = findWebAwesomeDir();
    if (!compDir) {
      throw new Error('Web Awesome package not found in node_modules.');
    }

    const components = fs.readdirSync(compDir).filter((name) => {
      const fullPath = path.join(compDir, name, `${name}.js`);
      return fs.existsSync(fullPath);
    });

    const entryContent = components
      .map((name) => `import '@awesome.me/webawesome/dist/components/${name}/${name}.js';`)
      .join('\n');

    const entryPath = path.join(__dirname, '.webawesome-entry.js');
    fs.writeFileSync(entryPath, entryContent);

    const chunksPattern = path.join(compDir, '../chunks/*.js');

    return {
      id: 'webawesome',
      name: `Web Awesome (${components.length} components)`,
      entryPath,
      includePattern: chunksPattern,
      componentCount: components.length,
      metadata: {
        compDir,
        components,
      },
    };
  },

  async cleanup() {
    const entryPath = path.join(__dirname, '.webawesome-entry.js');
    if (fs.existsSync(entryPath)) {
      fs.rmSync(entryPath, { force: true });
    }
  },
};
