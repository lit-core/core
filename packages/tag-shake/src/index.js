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
    nativeBinding = currentArch === 'arm64'
      ? require('../tag-shake.darwin-arm64.node')
      : require('../tag-shake.darwin-x64.node');
  } else if (currentPlatform === 'linux') {
    nativeBinding = currentArch === 'arm64'
      ? require('../tag-shake.linux-arm64-gnu.node')
      : require('../tag-shake.linux-x64-gnu.node');
  }
} catch (_err) {
  try {
    const ext = currentPlatform === 'darwin' ? '.dylib' : currentPlatform === 'linux' ? '.so' : '.dll';
    const libPrefix = currentPlatform === 'win32' ? '' : 'lib';
    const libFileName = `${libPrefix}tag_shake${ext}`;
    const candidates = [
      path.resolve(import.meta.dirname, `../tag-shake.${currentPlatform}-${currentArch}.node`),
      path.resolve(import.meta.dirname, '../tag-shake.linux-x64-gnu.node'),
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
  throw new Error(`Failed to load native binding for @lit-core/tag-shake (${currentPlatform}-${currentArch})`);
}

export function scanTags(source, filename) {
  return nativeBinding.scanTags(source, filename);
}

export function transformTagShake(source, options = {}) {
  return nativeBinding.transformTagShake(source, options);
}

export default transformTagShake;
