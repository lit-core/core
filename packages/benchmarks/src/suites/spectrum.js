import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../..');

function findSpectrumDir() {
  const possible = [
    path.join(rootDir, 'node_modules/@spectrum-web-components'),
    path.resolve('node_modules/@spectrum-web-components'),
  ];
  return possible.find((p) => fs.existsSync(p)) || null;
}

/**
 * Adobe Spectrum Design System (@spectrum-web-components) benchmark suite definition.
 * 50+ enterprise web components built on Lit.
 * @type {import('../types.js').BenchmarkSuite}
 */
export const spectrumSuite = {
  id: 'spectrum',
  name: 'Spectrum Web Components (@spectrum-web-components)',
  description: 'Adobe Spectrum Design System Web Components built on Lit (Full Suite)',

  isAvailable() {
    return findSpectrumDir() !== null;
  },

  async setup() {
    const specDir = findSpectrumDir();
    if (!specDir) {
      throw new Error('Spectrum Web Components package not found in node_modules.');
    }

    const entryPath = path.join(__dirname, '.spectrum-entry.js');
    fs.writeFileSync(entryPath, "import '@spectrum-web-components/bundle/elements.js';\n");

    const includePattern = path.join(specDir, '**/*.js');

    return {
      id: 'spectrum',
      name: 'Spectrum Web Components (50+ components)',
      entryPath,
      includePattern,
      componentCount: 52,
      metadata: { specDir },
    };
  },

  async cleanup() {
    const entryPath = path.join(__dirname, '.spectrum-entry.js');
    if (fs.existsSync(entryPath)) {
      fs.rmSync(entryPath, { force: true });
    }
  },
};
