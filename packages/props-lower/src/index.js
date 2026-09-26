import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';

const require = createRequire(import.meta.url);

let nativeBinding = null;

if (platform() === 'darwin') {
  if (arch() === 'arm64') {
    nativeBinding = require('../props-lower.darwin-arm64.node');
  } else {
    nativeBinding = require('../props-lower.darwin-x64.node');
  }
} else if (platform() === 'linux') {
  if (arch() === 'x64') {
    nativeBinding = require('../props-lower.linux-x64-gnu.node');
  } else {
    throw new Error(`Unsupported linux architecture: ${arch()}`);
  }
} else {
  throw new Error(`Unsupported platform: ${platform()} ${arch()}`);
}

export const { transformLitProps } = nativeBinding;
