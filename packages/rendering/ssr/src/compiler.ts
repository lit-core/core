export interface TransformSsrOptions {
  filename?: string;
  sourcemap?: boolean;
  ssrMode?: boolean;
  islands?: boolean;
  islandsInclude?: string[];
  islandsExclude?: string[];
}

export interface TransformSsrResult {
  code: string;
  map?: string | null;
  modified: boolean;
  discoveredTags: string[];
  syntaxError?: string | null;
}

let cachedBinding: any = null;
let bindingLoaded = false;

function getNativeBinding(): any {
  if (bindingLoaded) {
    return cachedBinding;
  }
  bindingLoaded = true;

  const proc = (globalThis as any).process;
  if (!proc || typeof proc.getBuiltinModule !== 'function') {
    return null;
  }

  const nodeModule = proc.getBuiltinModule('node:module');
  const nodeOs = proc.getBuiltinModule('node:os');
  const nodePath = proc.getBuiltinModule('node:path');
  const nodeFs = proc.getBuiltinModule('node:fs');
  if (!nodeModule?.createRequire || !nodeOs || !nodePath || !nodeFs) {
    return null;
  }

  const require = nodeModule.createRequire(import.meta.url);
  const currentPlatform = nodeOs.platform();
  const currentArch = nodeOs.arch();
  const metaDir = (import.meta as any).dirname || '.';

  try {
    if (currentPlatform === 'darwin') {
      cachedBinding = currentArch === 'arm64' ? require('../ssr.darwin-arm64.node') : require('../ssr.darwin-x64.node');
    } else if (currentPlatform === 'linux') {
      cachedBinding = currentArch === 'arm64' ? require('../ssr.linux-arm64-gnu.node') : require('../ssr.linux-x64-gnu.node');
    }
  } catch {
    try {
      const ext = currentPlatform === 'darwin' ? '.dylib' : currentPlatform === 'linux' ? '.so' : '.dll';
      const libPrefix = currentPlatform === 'win32' ? '' : 'lib';
      const libFileName = `${libPrefix}ssr${ext}`;
      const candidates = [
        nodePath.resolve(metaDir, `../ssr.${currentPlatform}-${currentArch}.node`),
        nodePath.resolve(metaDir, '../ssr.linux-x64-gnu.node'),
        nodePath.resolve(metaDir, `../target/release/${libFileName}`),
        nodePath.resolve(metaDir, `../../../target/release/${libFileName}`),
        nodePath.resolve(metaDir, `../../../../target/release/${libFileName}`),
        nodePath.resolve(metaDir, `../target/debug/${libFileName}`),
        nodePath.resolve(metaDir, `../../../target/debug/${libFileName}`),
        nodePath.resolve(metaDir, `../../../../target/debug/${libFileName}`),
      ];
      for (const c of candidates) {
        if (nodeFs.existsSync(c)) {
          cachedBinding = require(c);
          break;
        }
      }
    } catch {}
  }

  return cachedBinding;
}

/**
 * Ahead-of-time native Rust OXC AST transform for SSR components and islands.
 * Strips browser-only lifecycle bodies in SSR mode and tags island classes.
 */
export function transformSsrComponent(source: string, options: TransformSsrOptions = {}): TransformSsrResult {
  const binding = getNativeBinding();
  if (binding?.transformSsrComponent) {
    return binding.transformSsrComponent(source, {
      filename: options.filename,
      sourcemap: options.sourcemap,
      ssrMode: options.ssrMode,
      islands: options.islands,
      islandsInclude: options.islandsInclude,
      islandsExclude: options.islandsExclude,
    });
  }
  throw new Error('Native @lit-core/ssr OXC compiler addon not loaded.');
}
