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
    nativeBinding = currentArch === 'arm64' ? require('../memoize.darwin-arm64.node') : require('../memoize.darwin-x64.node');
  } else if (currentPlatform === 'linux') {
    nativeBinding = currentArch === 'arm64' ? require('../memoize.linux-arm64-gnu.node') : require('../memoize.linux-x64-gnu.node');
  }
} catch (_err) {
  try {
    const ext = currentPlatform === 'darwin' ? '.dylib' : currentPlatform === 'linux' ? '.so' : '.dll';
    const libPrefix = currentPlatform === 'win32' ? '' : 'lib';
    const libFileName = `${libPrefix}memoize${ext}`;
    const candidates = [
      path.resolve(import.meta.dirname, `../memoize.${currentPlatform}-${currentArch}.node`),
      path.resolve(import.meta.dirname, '../memoize.linux-x64-gnu.node'),
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
  throw new Error(`Failed to load native binding for @lit-core/memoize (${currentPlatform}-${currentArch})`);
}

export function transformMemoize(source, options = {}) {
  return nativeBinding.transformMemoize(source, options);
}

export default transformMemoize;
