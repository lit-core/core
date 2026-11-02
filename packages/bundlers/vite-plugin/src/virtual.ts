import { DOM_PATHS_SOURCE } from '@lit-core/dom-paths';
import { NATIVE_RUNTIME_SOURCE } from '@lit-core/native';
import { HYDRATE_SUPPORT_SOURCE, RESUMABLE_ADAPTER_SOURCE } from '@lit-core/resumable';
import { compileResumableLoader } from '@lit-core/resumable/compiler';

export const SSR_RUNTIME_SOURCE = "export { render, renderToStream, renderToString, collectResult, createIsolateEnvironment, installIsolateGlobals } from '@lit-core/ssr';";

export const INSTALL_GLOBALS_SOURCE = "import { installIsolateGlobals } from '@lit-core/ssr';\ninstallIsolateGlobals();\n";

export const EXECUTOR_SOURCE = "export * from '@lit-core/server-elements/executor';";

let cachedIslandsLoaderSource: string | undefined;

export function getIslandsLoaderSource(): string {
  if (cachedIslandsLoaderSource === undefined) {
    cachedIslandsLoaderSource = compileResumableLoader({ islands: true });
  }
  return cachedIslandsLoaderSource;
}

export const VIRTUAL_LIT_CORE_MODULES: Record<string, string> = {
  executor: EXECUTOR_SOURCE,
  'executor.js': EXECUTOR_SOURCE,
  'install-globals': INSTALL_GLOBALS_SOURCE,
  'install-globals.js': INSTALL_GLOBALS_SOURCE,
  'hydrate-support': HYDRATE_SUPPORT_SOURCE,
  'hydrate-support.js': HYDRATE_SUPPORT_SOURCE,
  'resumable-adapter': RESUMABLE_ADAPTER_SOURCE,
  resumable: RESUMABLE_ADAPTER_SOURCE,
  'native-runtime': NATIVE_RUNTIME_SOURCE,
  native: NATIVE_RUNTIME_SOURCE,
  reconciler: NATIVE_RUNTIME_SOURCE,
  'dom-paths': DOM_PATHS_SOURCE,
  'ssr-runtime': SSR_RUNTIME_SOURCE,
};

Object.defineProperty(VIRTUAL_LIT_CORE_MODULES, 'islands-loader', {
  get: getIslandsLoaderSource,
  enumerable: true,
  configurable: true,
});

export function getVirtualLitCoreModule(subpath: string): string | undefined {
  const clean = subpath
    .split('?')[0]
    .replace(/^\/+/, '')
    .replace(/\.[jt]s$/, '');
  if (clean === 'islands-loader') {
    return getIslandsLoaderSource();
  }
  return VIRTUAL_LIT_CORE_MODULES[clean];
}
