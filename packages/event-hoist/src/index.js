import fs from 'node:fs';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

let nativeBinding = null;

const currentPlatform = platform();
const currentArch = arch();

// Standard safe bubbling event types supported for ShadowRoot delegation
export const SAFE_BUBBLING_EVENTS = ['click', 'dblclick', 'input', 'change', 'keydown', 'keyup', 'keypress', 'pointerdown', 'pointerup', 'focusin', 'focusout'];

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

if (!nativeBinding) {
  throw new Error('Failed to load native binding for @lit-core/event-hoist. Native addon not found.');
}

export function transformEventHoist(source, options = {}) {
  return nativeBinding.transformEventHoist(source, options);
}

export default transformEventHoist;
