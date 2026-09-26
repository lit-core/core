import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../..');

function findMomentumDir() {
  const possible = [
    path.join(rootDir, 'node_modules/@momentum-design/components'),
    path.resolve('node_modules/@momentum-design/components'),
    path.resolve(__dirname, '../../node_modules/@momentum-design/components'),
  ];
  return possible.find((p) => fs.existsSync(p)) || null;
}

/**
 * Momentum Design (@momentum-design/components) benchmark suite definition.
 * Cisco Momentum Design System web components built on Lit.
 * @type {import('../types.js').BenchmarkSuite}
 */
export const momentumSuite = {
  id: 'momentum',
  name: 'Momentum Design (@momentum-design/components)',
  description: 'Cisco Momentum Design System Web Components built on Lit (Full Suite)',

  isAvailable() {
    return findMomentumDir() !== null;
  },

  async setup() {
    const momDir = findMomentumDir();
    if (!momDir) {
      throw new Error('Momentum Design package not found in node_modules.');
    }

    const compBaseDir = path.join(momDir, 'dist/components');
    const components = fs.existsSync(compBaseDir)
      ? fs.readdirSync(compBaseDir).filter((name) => {
          const p = path.join(compBaseDir, name, 'index.js');
          return fs.existsSync(p);
        })
      : [];

    const entryPath = path.join(__dirname, '.momentum-entry.js');
    fs.writeFileSync(entryPath, "import '@momentum-design/components';\n");

    const includePattern = path.join(momDir, 'dist/**/*.js');

    return {
      id: 'momentum',
      name: `Momentum Design (${components.length} components)`,
      entryPath,
      includePattern,
      componentCount: components.length,
      metadata: { momDir, components },
    };
  },

  async cleanup() {
    const entryPath = path.join(__dirname, '.momentum-entry.js');
    if (fs.existsSync(entryPath)) {
      fs.rmSync(entryPath, { force: true });
    }
  },
};
