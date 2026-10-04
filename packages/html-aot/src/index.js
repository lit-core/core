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
      nativeBinding = require('../html-aot.darwin-arm64.node');
    } else {
      nativeBinding = require('../html-aot.darwin-x64.node');
    }
  } else if (currentPlatform === 'linux') {
    if (currentArch === 'x64') {
      nativeBinding = require('../html-aot.linux-x64-gnu.node');
    }
  }
} catch (_err) {
  try {
    const localNode = path.resolve(import.meta.dirname, `../html-aot.${currentPlatform}-${currentArch}.node`);
    if (fs.existsSync(localNode)) {
      nativeBinding = require(localNode);
    } else {
      const dylib = path.resolve(import.meta.dirname, '../target/release/libhtml_aot.dylib');
      if (fs.existsSync(dylib)) {
        nativeBinding = require(dylib);
      } else {
        const so = path.resolve(import.meta.dirname, '../target/release/libhtml_aot.so');
        if (fs.existsSync(so)) {
          nativeBinding = require(so);
        }
      }
    }
  } catch {}
}

if (!nativeBinding) {
  throw new Error('Failed to load native binding for @lit-core/html-aot. Native addon not found.');
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
