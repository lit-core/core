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
    nativeBinding = currentArch === 'arm64' ? require('../html-aot.darwin-arm64.node') : require('../html-aot.darwin-x64.node');
  } else if (currentPlatform === 'linux') {
    nativeBinding = currentArch === 'arm64' ? require('../html-aot.linux-arm64-gnu.node') : require('../html-aot.linux-x64-gnu.node');
  }
} catch (_err) {
  try {
    const ext = currentPlatform === 'darwin' ? '.dylib' : currentPlatform === 'linux' ? '.so' : '.dll';
    const libPrefix = currentPlatform === 'win32' ? '' : 'lib';
    const libFileName = `${libPrefix}html_aot${ext}`;
    const candidates = [
      path.resolve(import.meta.dirname, `../html-aot.${currentPlatform}-${currentArch}.node`),
      path.resolve(import.meta.dirname, '../html-aot.linux-x64-gnu.node'),
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
  throw new Error(`Failed to load native binding for @lit-core/html-aot (${currentPlatform}-${currentArch})`);
}

export const { transformHtmlAot } = nativeBinding;

export function compileHtmlAot(source, options = {}) {
  return nativeBinding.transformHtmlAot(source, options);
}

export const PartType = {
  ATTRIBUTE: 1,
  CHILD: 2,
  PROPERTY: 3,
  BOOLEAN_ATTRIBUTE: 4,
  EVENT: 5,
  ELEMENT: 6,
  COMMENT_PART: 7,
};

export const AttributeKind = {
  ATTRIBUTE: 1,
  PROPERTY: 3,
  BOOLEAN_ATTRIBUTE: 4,
  EVENT: 5,
};

export default compileHtmlAot;
