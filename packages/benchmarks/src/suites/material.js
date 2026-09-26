import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../..');

function findMaterialDir() {
  const possible = [path.join(rootDir, 'node_modules/@material/web'), path.resolve('node_modules/@material/web')];
  return possible.find((p) => fs.existsSync(p)) || null;
}

/**
 * Material Web (@material/web) benchmark suite definition.
 * Official Google Material Design 3 web components built on Lit.
 * @type {import('../types.js').BenchmarkSuite}
 */
export const materialSuite = {
  id: 'material',
  name: 'Material Web (@material/web)',
  description: 'Google Material Design 3 Web Components built on Lit (Full Suite)',

  isAvailable() {
    return findMaterialDir() !== null;
  },

  async setup() {
    const matDir = findMaterialDir();
    if (!matDir) {
      throw new Error('Material Web package not found in node_modules.');
    }

    const entryPath = path.join(__dirname, '.material-entry.js');
    fs.writeFileSync(entryPath, "import '@material/web/all.js';\n");

    const includePattern = path.join(matDir, '**/*.js');

    return {
      id: 'material',
      name: 'Material Web (Full Suite)',
      entryPath,
      includePattern,
      componentCount: 28,
      metadata: { matDir },
    };
  },

  async cleanup() {
    const entryPath = path.join(__dirname, '.material-entry.js');
    if (fs.existsSync(entryPath)) {
      fs.rmSync(entryPath, { force: true });
    }
  },
};
