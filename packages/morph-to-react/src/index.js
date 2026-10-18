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
    nativeBinding = currentArch === 'arm64' ? require('../morph-to-react.darwin-arm64.node') : require('../morph-to-react.darwin-x64.node');
  } else if (currentPlatform === 'linux') {
    nativeBinding = currentArch === 'arm64' ? require('../morph-to-react.linux-arm64-gnu.node') : require('../morph-to-react.linux-x64-gnu.node');
  }
} catch (_err) {
  try {
    const ext = currentPlatform === 'darwin' ? '.dylib' : currentPlatform === 'linux' ? '.so' : '.dll';
    const libPrefix = currentPlatform === 'win32' ? '' : 'lib';
    const libFileName = `${libPrefix}morph_to_react${ext}`;
    const candidates = [
      path.resolve(import.meta.dirname, `../morph-to-react.${currentPlatform}-${currentArch}.node`),
      path.resolve(import.meta.dirname, '../morph-to-react.linux-x64-gnu.node'),
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
  throw new Error(`Failed to load native binding for @lit-core/morph-to-react (${currentPlatform}-${currentArch})`);
}

export const { analyzeLit, parseLitTemplate, compileModule: compileModuleNative, clearCompileCache, getCompileCacheSize } = nativeBinding;
export const analyzeLitModule = (source, options) => nativeBinding.analyzeLit(source, options);
export const compileModule = (source, options) => nativeBinding.compileModule(source, options);
