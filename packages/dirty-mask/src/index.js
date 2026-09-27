import fs from 'node:fs';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';
import path from 'node:path';
import { transformDirtyMaskJs } from './js-fallback.js';

const require = createRequire(import.meta.url);

let nativeBinding = null;

const currentPlatform = platform();
const currentArch = arch();

// Try loading platform-specific native addon
try {
  if (currentPlatform === 'darwin') {
    if (currentArch === 'arm64') {
      nativeBinding = require('../dirty-mask.darwin-arm64.node');
    } else {
      nativeBinding = require('../dirty-mask.darwin-x64.node');
    }
  } else if (currentPlatform === 'linux') {
    if (currentArch === 'x64') {
      nativeBinding = require('../dirty-mask.linux-x64-gnu.node');
    }
  }
} catch (_err) {
  try {
    const localNode = path.resolve(import.meta.dirname, '../dirty-mask.darwin-arm64.node');
    if (fs.existsSync(localNode)) {
      nativeBinding = require(localNode);
    } else {
      const dylib = path.resolve(import.meta.dirname, '../target/release/libdirty_mask.dylib');
      if (fs.existsSync(dylib)) {
        nativeBinding = require(dylib);
      }
    }
  } catch {}
}

export { transformDirtyMaskJs };

export function transformDirtyMask(source, options = {}) {
  if (nativeBinding && typeof nativeBinding.transformDirtyMask === 'function') {
    try {
      return nativeBinding.transformDirtyMask(source, options);
    } catch (_err) {
      // Fall through to JS fallback
    }
  }

  return transformDirtyMaskJs(source, options);
}
