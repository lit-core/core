import fs from 'node:fs';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';
import path from 'node:path';
import { preparePartsWithPaths, resolveNodeByPath, resolveNodesByPaths } from './client.js';
import { computeDomPathsJs, transformDomPathsJs } from './js-fallback.js';

const require = createRequire(import.meta.url);

let nativeBinding = null;

const currentPlatform = platform();
const currentArch = arch();

// Try loading platform-specific native addon
try {
  if (currentPlatform === 'darwin') {
    if (currentArch === 'arm64') {
      nativeBinding = require('../dom-paths.darwin-arm64.node');
    } else {
      nativeBinding = require('../dom-paths.darwin-x64.node');
    }
  } else if (currentPlatform === 'linux') {
    if (currentArch === 'x64') {
      nativeBinding = require('../dom-paths.linux-x64-gnu.node');
    }
  }
} catch (_err) {
  // If platform-specific binary is not found, check target/release dylib or local node file
  try {
    const localNode = path.resolve(import.meta.dirname, '../dom-paths.darwin-arm64.node');
    if (fs.existsSync(localNode)) {
      nativeBinding = require(localNode);
    } else {
      const dylib = path.resolve(import.meta.dirname, '../target/release/libdom_paths.dylib');
      if (fs.existsSync(dylib)) {
        nativeBinding = require(dylib);
      }
    }
  } catch {}
}

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
  if (nativeBinding && typeof nativeBinding.computeDomPaths === 'function') {
    try {
      return nativeBinding.computeDomPaths(Array.from(templateStrings), normalizeWhitespace);
    } catch (_err) {
      // Fall through to JS fallback
    }
  }
  return computeDomPathsJs(templateStrings, options);
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
  if (nativeBinding && typeof nativeBinding.transformDomPaths === 'function') {
    try {
      return nativeBinding.transformDomPaths(source, options);
    } catch (_err) {
      // Fall through to JS fallback
    }
  }
  return transformDomPathsJs(source, options);
}

export default transformDomPaths;
