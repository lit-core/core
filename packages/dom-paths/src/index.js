import fs from 'node:fs';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';
import path from 'node:path';
import { preparePartsWithPaths, resolveNodeByPath, resolveNodesByPaths } from './client.js';

const require = createRequire(import.meta.url);

let nativeBinding = null;

const currentPlatform = platform();
const currentArch = arch();

// Try loading platform-specific native addon
try {
  if (currentPlatform === 'darwin') {
    nativeBinding = currentArch === 'arm64' ? require('../dom-paths.darwin-arm64.node') : require('../dom-paths.darwin-x64.node');
  } else if (currentPlatform === 'linux') {
    nativeBinding = currentArch === 'arm64' ? require('../dom-paths.linux-arm64-gnu.node') : require('../dom-paths.linux-x64-gnu.node');
  }
} catch (_err) {
  try {
    const ext = currentPlatform === 'darwin' ? '.dylib' : currentPlatform === 'linux' ? '.so' : '.dll';
    const libPrefix = currentPlatform === 'win32' ? '' : 'lib';
    const libFileName = `${libPrefix}dom_paths${ext}`;
    const candidates = [
      path.resolve(import.meta.dirname, `../dom-paths.${currentPlatform}-${currentArch}.node`),
      path.resolve(import.meta.dirname, '../dom-paths.linux-x64-gnu.node'),
      path.resolve(import.meta.dirname, `../target/release/${libFileName}`),
      path.resolve(import.meta.dirname, `../../target/release/${libFileName}`),
      path.resolve(import.meta.dirname, `../target/debug/${libFileName}`),
      path.resolve(import.meta.dirname, `../../target/debug/${libFileName}`),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        nativeBinding = require(c);
        break;
      }
    }
  } catch {}
}

if (!nativeBinding) {
  throw new Error(`Failed to load native binding for @lit-core/dom-paths (${currentPlatform}-${currentArch})`);
}

export { DOM_PATHS_SOURCE } from './virtual.js';
export { preparePartsWithPaths, resolveNodeByPath, resolveNodesByPaths };

/**
 * Computes structural DOM child paths for dynamic parts in Lit html tagged templates.
 *
 * @param {string[] | TemplateStringsArray} templateStrings
 * @param {object} [options]
 * @param {boolean} [options.normalizeWhitespace=true]
 * @returns {number[][]}
 */
export function computeDomPaths(templateStrings, options = {}) {
  const normalizeWhitespace = options.normalizeWhitespace !== false;
  return nativeBinding.computeDomPaths(Array.from(templateStrings), normalizeWhitespace);
}

/**
 * Transforms JavaScript / TypeScript source code to emit precomputed structural DOM paths
 * on Lit component classes.
 *
 * @param {string} source
 * @param {object} [options]
 * @returns {{ code: string, map?: string | null, componentsCount: number, pathsCount: number, paths: number[][][] }}
 */
export function transformDomPaths(source, options = {}) {
  return nativeBinding.transformDomPaths(source, options);
}

export default transformDomPaths;
