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

if (!nativeBinding) {
  throw new Error('Failed to load native binding for @lit-core/dom-paths. Native addon not found.');
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
