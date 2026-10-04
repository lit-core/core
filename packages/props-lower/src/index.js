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
    nativeBinding = currentArch === 'arm64' ? require('../props-lower.darwin-arm64.node') : require('../props-lower.darwin-x64.node');
  } else if (currentPlatform === 'linux') {
    nativeBinding = currentArch === 'arm64' ? require('../props-lower.linux-arm64-gnu.node') : require('../props-lower.linux-x64-gnu.node');
  }
} catch (_err) {
  try {
    const ext = currentPlatform === 'darwin' ? '.dylib' : currentPlatform === 'linux' ? '.so' : '.dll';
    const libPrefix = currentPlatform === 'win32' ? '' : 'lib';
    const libFileName = `${libPrefix}props_lower${ext}`;
    const candidates = [
      path.resolve(import.meta.dirname, `../props-lower.${currentPlatform}-${currentArch}.node`),
      path.resolve(import.meta.dirname, '../props-lower.linux-x64-gnu.node'),
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
  throw new Error(`Failed to load native binding for @lit-core/props-lower (${currentPlatform}-${currentArch})`);
}

export const { transformLitProps } = nativeBinding;
