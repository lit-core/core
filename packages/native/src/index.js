import fs from 'node:fs';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

let nativeBinding = null;
const currentPlatform = platform();
const currentArch = arch();

try {
  if (currentPlatform === 'darwin') {
    nativeBinding = currentArch === 'arm64' ? require('../native.darwin-arm64.node') : require('../native.darwin-x64.node');
  } else if (currentPlatform === 'linux') {
    nativeBinding = currentArch === 'arm64' ? require('../native.linux-arm64-gnu.node') : require('../native.linux-x64-gnu.node');
  }
} catch (_err) {
  try {
    const ext = currentPlatform === 'darwin' ? '.dylib' : currentPlatform === 'linux' ? '.so' : '.dll';
    const libPrefix = currentPlatform === 'win32' ? '' : 'lib';
    const libFileName = `${libPrefix}native${ext}`;
    const candidates = [
      path.resolve(import.meta.dirname, `../native.${currentPlatform}-${currentArch}.node`),
      path.resolve(import.meta.dirname, '../native.linux-x64-gnu.node'),
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
  throw new Error(`Failed to load native binding for @lit-core/native (${currentPlatform}-${currentArch})`);
}

export { NATIVE_RUNTIME_SOURCE } from './virtual.js';
export const { classify, transformNative } = nativeBinding;
export default transformNative;
