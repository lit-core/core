import fs from 'node:fs';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

let nativeBinding = null;

const currentPlatform = platform();
const currentArch = arch();

// Try loading platform-specific native addon
try {
  if (currentPlatform === 'darwin') {
    if (currentArch === 'arm64') {
      nativeBinding = require('../tag-shake.darwin-arm64.node');
    } else {
      nativeBinding = require('../tag-shake.darwin-x64.node');
    }
  } else if (currentPlatform === 'linux') {
    if (currentArch === 'x64') {
      nativeBinding = require('../tag-shake.linux-x64-gnu.node');
    }
  }
} catch (_err) {
  try {
    const localNode = path.resolve(import.meta.dirname, '../tag-shake.darwin-arm64.node');
    if (fs.existsSync(localNode)) {
      nativeBinding = require(localNode);
    } else {
      const dylib = path.resolve(import.meta.dirname, '../target/release/libtag_shake.dylib');
      if (fs.existsSync(dylib)) {
        nativeBinding = require(dylib);
      }
    }
  } catch {}
}

if (!nativeBinding) {
  throw new Error('Failed to load native binding for @lit-core/tag-shake. Native addon not found.');
}

export function scanTags(source, filename) {
  return nativeBinding.scanTags(source, filename);
}

export function transformTagShake(source, options = {}) {
  return nativeBinding.transformTagShake(source, options);
}

export default transformTagShake;
