import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';

const require = createRequire(import.meta.url);

let nativeBinding = null;

if (platform() === 'darwin') {
  if (arch() === 'arm64') {
    nativeBinding = require('../html-fuse.darwin-arm64.node');
  } else {
    nativeBinding = require('../html-fuse.darwin-x64.node');
  }
} else if (platform() === 'linux') {
  if (arch() === 'x64') {
    nativeBinding = require('../html-fuse.linux-x64-gnu.node');
  } else {
    throw new Error(`Unsupported linux architecture: ${arch()}`);
  }
} else {
  throw new Error(`Unsupported platform: ${platform()} ${arch()}`);
}

export const { fuse, analyze, auditTemplates } = nativeBinding;
export default nativeBinding;
