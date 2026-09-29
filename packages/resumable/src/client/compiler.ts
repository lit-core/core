import fs from 'node:fs';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

let nativeBinding: any = null;
const currentPlatform = platform();
const currentArch = arch();

try {
  if (currentPlatform === 'darwin') {
    if (currentArch === 'arm64') {
      nativeBinding = require('../../resumable.darwin-arm64.node');
    } else {
      nativeBinding = require('../../resumable.darwin-x64.node');
    }
  } else if (currentPlatform === 'linux') {
    if (currentArch === 'x64') {
      nativeBinding = require('../../resumable.linux-x64-gnu.node');
    }
  }
} catch {
  try {
    const localNode = path.resolve(import.meta.dirname, '../../resumable.darwin-arm64.node');
    if (fs.existsSync(localNode)) {
      nativeBinding = require(localNode);
    } else {
      const dylib = path.resolve(import.meta.dirname, '../../target/release/libresumable.dylib');
      if (fs.existsSync(dylib)) {
        nativeBinding = require(dylib);
      }
    }
  } catch {}
}

export interface ResumableLoaderOptions {
  manifest?: Record<string, string>;
  preloadOnHover?: boolean;
  idleHydration?: boolean;
  idleTimeout?: number;
  events?: string[];
}

/**
 * Compile the resumable micro-loader using native OXC AST parsing and codegen ahead-of-time.
 */
export function compileResumableLoader(options: ResumableLoaderOptions = {}): string {
  if (nativeBinding?.compileResumableLoader) {
    return nativeBinding.compileResumableLoader(options);
  }
  throw new Error('Native @lit-core/resumable OXC compiler addon not loaded.');
}
