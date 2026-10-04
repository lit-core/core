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
    nativeBinding = currentArch === 'arm64' ? require('../event-hoist.darwin-arm64.node') : require('../event-hoist.darwin-x64.node');
  } else if (currentPlatform === 'linux') {
    nativeBinding = currentArch === 'arm64' ? require('../event-hoist.linux-arm64-gnu.node') : require('../event-hoist.linux-x64-gnu.node');
  }
} catch (_err) {
  try {
    const ext = currentPlatform === 'darwin' ? '.dylib' : currentPlatform === 'linux' ? '.so' : '.dll';
    const libPrefix = currentPlatform === 'win32' ? '' : 'lib';
    const libFileName = `${libPrefix}event_hoist${ext}`;
    const candidates = [
      path.resolve(import.meta.dirname, `../event-hoist.${currentPlatform}-${currentArch}.node`),
      path.resolve(import.meta.dirname, '../event-hoist.linux-x64-gnu.node'),
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
  throw new Error(`Failed to load native binding for @lit-core/event-hoist (${currentPlatform}-${currentArch})`);
}

export function transformEventHoist(source, options = {}) {
  return nativeBinding.transformEventHoist(source, options);
}

export default transformEventHoist;
