import { DOM_PATHS_SOURCE } from '@lit-core/dom-paths';
import { NATIVE_RUNTIME_SOURCE } from '@lit-core/native';
import { HYDRATE_SUPPORT_SOURCE, RESUMABLE_ADAPTER_SOURCE } from '@lit-core/resumable';
import { compileResumableLoader } from '@lit-core/resumable/compiler';
import { compileWorkerEntry } from '@lit-core/server-split';

export const SSR_RUNTIME_SOURCE = "export { render, renderToStream, renderToString, collectResult, createIsolateEnvironment, installIsolateGlobals } from '@lit-core/ssr';";

export const INSTALL_GLOBALS_SOURCE = "import { installIsolateGlobals } from '@lit-core/ssr';\ninstallIsolateGlobals();\n";

export const EXECUTOR_SOURCE = "export * from '@lit-core/server-elements/executor';";
export const MANIFEST_SOURCE = "export default { version: '1.0', elements: {}, actionIndex: {} };";

let cachedIslandsLoaderSource: string | undefined;
let cachedWorkerSource: string | undefined;

export function getIslandsLoaderSource(): string {
  if (cachedIslandsLoaderSource === undefined) {
    cachedIslandsLoaderSource = compileResumableLoader({ islands: true });
  }
  return cachedIslandsLoaderSource;
}

export function getDefaultWorkerSource(): string {
  if (cachedWorkerSource === undefined) {
    cachedWorkerSource = compileWorkerEntry({ elements: [] });
  }
  return cachedWorkerSource;
}

export const WORKER_SOURCE =
  "import 'virtual:lit-core/install-globals';\nimport { handleActionRequest } from '@lit-core/server-elements/action-endpoint';\nimport { transformServerElementsWithHtmlRewriter } from '@lit-core/server-elements/edge';\nexport const tagManifest = {};\nexport const registry = { get(tagName) { return globalThis.customElements?.get(tagName); } };\nexport default {\n  async fetch(request, env = {}, ctx = {}) {\n    const url = new URL(request.url);\n    if (request.method === 'POST' && url.pathname.startsWith('/_lit/a/')) {\n      return handleActionRequest(request, { env, secret: env.LIT_ACTION_SECRET, registry, customElements: registry, routePrefix: '/_lit/a/' });\n    }\n    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {\n      const res = await env.ASSETS.fetch(request);\n      return res.headers.get('content-type')?.includes('text/html') ? transformServerElementsWithHtmlRewriter(res, { request, env, secret: env.LIT_ACTION_SECRET, customElements: registry }) : res;\n    }\n    return new Response('Not Found', { status: 404 });\n  }\n};";

export const VIRTUAL_LIT_CORE_MODULES: Record<string, string> = {
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
  executor: EXECUTOR_SOURCE,
  manifest: MANIFEST_SOURCE,
  worker: WORKER_SOURCE,
  'worker.js': WORKER_SOURCE,
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
    .replace(/\.(?:[jt]s|json)$/, '');
  if (clean === 'islands-loader') {
    return getIslandsLoaderSource();
  }
  return VIRTUAL_LIT_CORE_MODULES[clean];
}
