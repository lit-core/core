import fs from 'node:fs';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';
import path from 'node:path';
import { SAFE_BUBBLING_EVENTS, transformEventHoistJs } from './js-fallback.js';

const require = createRequire(import.meta.url);

let nativeBinding = null;

const currentPlatform = platform();
const currentArch = arch();

// Try loading platform-specific native addon
try {
  if (currentPlatform === 'darwin') {
    if (currentArch === 'arm64') {
      nativeBinding = require('../event-hoist.darwin-arm64.node');
    } else {
      nativeBinding = require('../event-hoist.darwin-x64.node');
    }
  } else if (currentPlatform === 'linux') {
    if (currentArch === 'x64') {
      nativeBinding = require('../event-hoist.linux-x64-gnu.node');
    }
  }
} catch (_err) {
  // If platform-specific binary is not found, check target/release dylib or local node file
  try {
    const localNode = path.resolve(import.meta.dirname, '../event-hoist.darwin-arm64.node');
    if (fs.existsSync(localNode)) {
      nativeBinding = require(localNode);
    } else {
      const dylib = path.resolve(import.meta.dirname, '../target/release/libevent_hoist.dylib');
      if (fs.existsSync(dylib)) {
        nativeBinding = require(dylib);
      }
    }
  } catch {}
}

export { SAFE_BUBBLING_EVENTS };

export function transformEventHoist(source, options = {}) {
  if (nativeBinding && typeof nativeBinding.transformEventHoist === 'function') {
    try {
      return nativeBinding.transformEventHoist(source, options);
    } catch (_err) {
      // Fall through to JS fallback
    }
  }

  // Pure JavaScript general-purpose fallback
  return transformEventHoistJs(source, options);
}
