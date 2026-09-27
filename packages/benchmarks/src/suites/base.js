import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../..');

/**
 * Helper to locate a package directory across workspace root and package-local node_modules.
 * @param {string} relativePackagePath e.g. '@carbon/web-components'
 * @returns {string | null}
 */
export function resolvePackageDir(relativePackagePath) {
  const possiblePaths = [
    path.join(rootDir, 'node_modules', relativePackagePath),
    path.resolve('node_modules', relativePackagePath),
    path.resolve(__dirname, '../../node_modules', relativePackagePath),
  ];
  return possiblePaths.find((p) => fs.existsSync(p)) || null;
}

/**
 * Scan a directory for subdirectories containing an entry file (e.g. index.js or [name].js).
 * @param {string} baseDir
 * @param {(componentName: string, componentDir: string) => string | null} resolveEntry
 * @returns {Array<{ name: string, entryFile: string }>}
 */
export function scanComponentEntries(baseDir, resolveEntry) {
  if (!fs.existsSync(baseDir)) return [];
  return fs
    .readdirSync(baseDir)
    .map((name) => {
      const compDir = path.join(baseDir, name);
      const entryFile = resolveEntry(name, compDir);
      return entryFile && fs.existsSync(entryFile) ? { name, entryFile } : null;
    })
    .filter((c) => c !== null);
}

/**
 * @typedef {Object} CreateComponentSuiteOptions
 * @property {string} id Unique suite ID
 * @property {string} name Display name
 * @property {string} description Suite description
 * @property {string} packageName NPM package name e.g. '@carbon/web-components'
 * @property {string} entryFileName Temporary entry filename (e.g. '.carbon-entry.js')
 * @property {(pkgDir: string) => { entryContent: string, componentCount: number, includePattern: string | string[], metadata?: Record<string, any> }} resolveConfig
 */

/**
 * Factory function creating a standardized BenchmarkSuite definition.
 * Eliminates duplicate file resolution, lifecycle setup/cleanup, and error handling.
 * @param {CreateComponentSuiteOptions} options
 * @returns {import('../types.js').BenchmarkSuite}
 */
export function createComponentSuite({ id, name, description, packageName, entryFileName, resolveConfig }) {
  const entryPath = path.join(__dirname, entryFileName);

  return {
    id,
    name,
    description,

    isAvailable() {
      return resolvePackageDir(packageName) !== null;
    },

    async setup() {
      const pkgDir = resolvePackageDir(packageName);
      if (!pkgDir) {
        throw new Error(`${name} package (${packageName}) not found in node_modules.`);
      }

      let version = 'unknown';
      try {
        const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
        version = pkgJson.version || 'unknown';
      } catch {}

      const { entryContent, componentCount, includePattern, metadata } = resolveConfig(pkgDir);
      fs.writeFileSync(entryPath, entryContent);

      return {
        id,
        name,
        packageName,
        version,
        entryPath,
        includePattern,
        componentCount,
        metadata: { ...metadata, packageDir: pkgDir, version },
      };
    },

    async cleanup() {
      if (fs.existsSync(entryPath)) {
        fs.rmSync(entryPath, { force: true });
      }
    },
  };
}
