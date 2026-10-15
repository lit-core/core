let nativeBinding: any = null;
let bindingLoaded = false;

function getNativeBinding(): any {
  if (bindingLoaded) {
    return nativeBinding;
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
      nativeBinding = currentArch === 'arm64' ? require('../../resumable.darwin-arm64.node') : require('../../resumable.darwin-x64.node');
    } else if (currentPlatform === 'linux') {
      nativeBinding = currentArch === 'arm64' ? require('../../resumable.linux-arm64-gnu.node') : require('../../resumable.linux-x64-gnu.node');
    }
  } catch (_err) {
    try {
      const ext = currentPlatform === 'darwin' ? '.dylib' : currentPlatform === 'linux' ? '.so' : '.dll';
      const libPrefix = currentPlatform === 'win32' ? '' : 'lib';
      const libFileName = `${libPrefix}resumable${ext}`;
      const candidates = [
        nodePath.resolve(metaDir, `../../resumable.${currentPlatform}-${currentArch}.node`),
        nodePath.resolve(metaDir, '../../resumable.linux-x64-gnu.node'),
        nodePath.resolve(metaDir, `../../target/release/${libFileName}`),
        nodePath.resolve(metaDir, `../../../target/release/${libFileName}`),
        nodePath.resolve(metaDir, `../../target/debug/${libFileName}`),
        nodePath.resolve(metaDir, `../../../target/debug/${libFileName}`),
      ];
      for (const c of candidates) {
        if (nodeFs.existsSync(c)) {
          nativeBinding = require(c);
          break;
        }
      }
    } catch {}
  }

  return nativeBinding;
}

export interface ResumableLoaderOptions {
  manifest?: Record<string, string>;
  preloadOnHover?: boolean;
  idleHydration?: boolean;
  idleTimeout?: number;
  events?: string[];
}

export interface TransformResumableOptions {
  filename?: string;
  sourcemap?: boolean;
  virtualModule?: string;
}

export interface TransformResumableResult {
  code: string;
  map?: string | null;
  transformed: boolean;
}

/**
 * Compile the resumable micro-loader using native OXC AST parsing and codegen ahead-of-time.
 */
export function compileResumableLoader(options: ResumableLoaderOptions = {}): string {
  const binding = getNativeBinding();
  if (binding?.compileResumableLoader) {
    return binding.compileResumableLoader(options);
  }
  throw new Error('Native @lit-core/resumable OXC compiler addon not loaded.');
}

/**
 * Ahead-of-time AST transform injecting resumable adapter imports into custom element components.
 */
export function transformResumableComponent(source: string, options: TransformResumableOptions = {}): TransformResumableResult {
  const binding = getNativeBinding();
  if (binding?.transformResumableComponent) {
    return binding.transformResumableComponent(source, {
      filename: options.filename,
      sourcemap: options.sourcemap,
      virtual_module: options.virtualModule,
    });
  }
  throw new Error('Native @lit-core/resumable OXC compiler addon not loaded.');
}
