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
    if (currentArch === 'arm64') {
      nativeBinding = require('../css-minifier.darwin-arm64.node');
    } else {
      nativeBinding = require('../css-minifier.darwin-x64.node');
    }
  } else if (currentPlatform === 'linux') {
    if (currentArch === 'x64') {
      nativeBinding = require('../css-minifier.linux-x64-gnu.node');
    }
  }
} catch (_err) {
  try {
    const candidates = [
      path.resolve(import.meta.dirname, `../css-minifier.${currentPlatform}-${currentArch}.node`),
      path.resolve(import.meta.dirname, '../css-minifier.linux-x64-gnu.node'),
      path.resolve(import.meta.dirname, '../target/release/libcss_minifier.so'),
      path.resolve(import.meta.dirname, '../target/release/libcss_minifier.dylib'),
      path.resolve(import.meta.dirname, '../../target/release/libcss_minifier.so'),
      path.resolve(import.meta.dirname, '../../target/release/libcss_minifier.dylib'),
      path.resolve(import.meta.dirname, '../target/debug/libcss_minifier.so'),
      path.resolve(import.meta.dirname, '../target/debug/libcss_minifier.dylib'),
      path.resolve(import.meta.dirname, '../../target/debug/libcss_minifier.so'),
      path.resolve(import.meta.dirname, '../../target/debug/libcss_minifier.dylib'),
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
  throw new Error(`Failed to load native binding for @lit-core/css-minifier on ${currentPlatform} (${currentArch}).`);
}

export const minifyEmbeddedCss = nativeBinding.minifyEmbeddedCss;
export const minifyTemplateCss = nativeBinding.minifyTemplateCss || nativeBinding.minifyEmbeddedCss;
export const transformEmbeddedCss = nativeBinding.minifyEmbeddedCss;
export default minifyEmbeddedCss;
