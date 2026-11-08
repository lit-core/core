import wasmInit, { compile_html_document_plan_wasm, compile_lit_descriptor_plan_wasm, compile_template_plan_wasm, extract_html_module_scripts_wasm, initSync as wasmInitSync } from '../wasm/ssr.js';
import type { SsrTemplatePlanV2 } from './compiler-bridge.js';

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
  staticTemplates?: string[];
  syntaxError?: string | null;
}

interface SsrWasmAdapter {
  compileTemplatePlan(quasisJson: string): string;
  compileLitDescriptorPlan(h: string, partsJson: string): string;
  compileHtmlDocumentPlan(html: string): string;
  extractHtmlModuleScripts(html: string): string;
}

let cachedBinding: any = null;
let bindingLoaded = false;
let wasmInitialized = false;
let wasmAdapter: SsrWasmAdapter | null = null;
let registeredWasmModule: WebAssembly.Module | BufferSource | null = null;
let registeredWasmSyncInit: ((module: WebAssembly.Module | BufferSource) => void) | null = null;
let forceWasmCompiler = false;
let nodeForcedWasmLoader: (() => boolean) | null = null;

function createSsrWasmAdapter(): SsrWasmAdapter {
  return {
    compileTemplatePlan: compile_template_plan_wasm,
    compileLitDescriptorPlan: compile_lit_descriptor_plan_wasm,
    compileHtmlDocumentPlan: compile_html_document_plan_wasm,
    extractHtmlModuleScripts: extract_html_module_scripts_wasm,
  };
}

function loadNodeForcedWasmFromDisk(): boolean {
  const proc = (globalThis as any).process;
  if (proc && typeof proc.getBuiltinModule === 'function') {
    const nodeFs = proc.getBuiltinModule('node:fs');
    const nodeUrl = proc.getBuiltinModule('node:url');
    if (nodeFs?.readFileSync && nodeUrl?.fileURLToPath) {
      try {
        const wasmUrl = new URL('../wasm/ssr_bg.wasm', import.meta.url);
        const wasmPath = nodeUrl.fileURLToPath(wasmUrl);
        if (nodeFs.existsSync(wasmPath)) {
          const bytes = nodeFs.readFileSync(wasmPath);
          initSsrWasmSync(bytes);
          return wasmAdapter !== null;
        }
      } catch {}
    }
  }
  return false;
}

export function setForceWasmCompiler(force: boolean): void {
  forceWasmCompiler = force;
  nodeForcedWasmLoader = force ? loadNodeForcedWasmFromDisk : null;
}

export function isSsrWasmReady(): boolean {
  return wasmInitialized;
}

export function registerSsrWasmModule(module: WebAssembly.Module | BufferSource): void {
  registeredWasmModule = module;
  registeredWasmSyncInit = initSsrWasmSync;
}

export function initSsrWasmSync(module: WebAssembly.Module | BufferSource): void {
  if (wasmInitialized) {
    return;
  }
  wasmInitSync({ module });
  wasmAdapter = createSsrWasmAdapter();
  wasmInitialized = true;
}

export async function initSsrWasm(moduleOrPath?: unknown): Promise<void> {
  if (wasmInitialized) {
    return;
  }
  if (moduleOrPath instanceof WebAssembly.Module || ArrayBuffer.isView(moduleOrPath) || moduleOrPath instanceof ArrayBuffer) {
    initSsrWasmSync(moduleOrPath as WebAssembly.Module | BufferSource);
    return;
  }
  await wasmInit(moduleOrPath !== undefined ? { module_or_path: moduleOrPath as any } : undefined);
  wasmAdapter = createSsrWasmAdapter();
  wasmInitialized = true;
}

function ensureWasmInitializedSync(): SsrWasmAdapter | null {
  if (wasmInitialized && wasmAdapter) {
    return wasmAdapter;
  }

  if (registeredWasmModule && registeredWasmSyncInit) {
    registeredWasmSyncInit(registeredWasmModule);
    return wasmAdapter;
  }

  if (nodeForcedWasmLoader?.()) {
    return wasmAdapter;
  }

  return null;
}

export function getNativeBinding(): any {
  if (forceWasmCompiler) {
    return null;
  }
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
  if (!nodeModule?.createRequire || !nodeOs || !nodePath || !nodeFs || !import.meta.url) {
    return null;
  }

  let require: NodeRequire;
  try {
    require = nodeModule.createRequire(import.meta.url);
  } catch {
    return null;
  }

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

/**
 * Compilation of Lit template strings into SsrTemplatePlanV2 via native addon or Wasm html5ever fallback.
 */
export function compileTemplatePlan(quasis: string[]): SsrTemplatePlanV2 {
  const binding = getNativeBinding();
  const fn = binding?.compileTemplatePlan || binding?.compile_template_plan;
  if (typeof fn === 'function') {
    const raw = fn.call(binding, quasis);
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  const adapter = ensureWasmInitializedSync();
  if (adapter) {
    const raw = adapter.compileTemplatePlan(JSON.stringify(quasis));
    return JSON.parse(raw);
  }

  throw new Error(
    '[@lit-core/ssr] Cannot render a template that was not compiled ahead of time: neither the native compiler addon nor an initialized Wasm compiler module is available in this runtime. ' +
      'Call `initSsrWasmSync(wasmModule)` or `await initSsrWasm()` in edge runtimes when rendering dynamic or `lit/static-html.js` templates.',
  );
}

/**
 * Compilation of a Lit compiled template descriptor into SsrTemplatePlanV2 via native addon or Wasm html5ever fallback.
 */
export function compileLitDescriptorPlan(descriptor: { h: string | TemplateStringsArray | string[]; parts?: any[] }): SsrTemplatePlanV2 {
  const htmlText = typeof descriptor.h === 'string' ? descriptor.h : Array.isArray(descriptor.h) ? ((descriptor.h as any)[0] ?? '') : String(descriptor.h ?? '');
  const partsJson = JSON.stringify(descriptor.parts || []);

  const binding = getNativeBinding();
  const fn = binding?.compileLitDescriptorPlan || binding?.compile_lit_descriptor_plan;
  if (typeof fn === 'function') {
    const raw = fn.call(binding, htmlText, partsJson);
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  const adapter = ensureWasmInitializedSync();
  if (adapter) {
    const raw = adapter.compileLitDescriptorPlan(htmlText, partsJson);
    return JSON.parse(raw);
  }

  throw new Error(
    '[@lit-core/ssr] Cannot render a template descriptor without an AOT SSR plan: neither the native compiler addon nor an initialized Wasm compiler module is available in this runtime.',
  );
}

/**
 * Compilation of a full HTML document or fragment into SsrTemplatePlanV2 via html5ever.
 */
export function compileHtmlDocumentPlan(html: string): SsrTemplatePlanV2 {
  const binding = getNativeBinding();
  const fn = binding?.compileHtmlDocumentPlan || binding?.compile_html_document_plan;
  if (typeof fn === 'function') {
    const raw = fn.call(binding, html);
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  const adapter = ensureWasmInitializedSync();
  if (adapter) {
    const raw = adapter.compileHtmlDocumentPlan(html);
    return JSON.parse(raw);
  }

  throw new Error('[@lit-core/ssr] Neither native addon nor Wasm compiler module is available to parse HTML document.');
}

/**
 * Extracts `<script type="module" src="...">` URLs from an HTML document via html5ever.
 */
export function extractHtmlModuleScripts(html: string): string[] {
  const binding = getNativeBinding();
  const fn = binding?.extractHtmlModuleScripts || binding?.extract_html_module_scripts;
  if (typeof fn === 'function') {
    const raw = fn.call(binding, html);
    return Array.isArray(raw) ? raw : JSON.parse(String(raw));
  }

  const adapter = ensureWasmInitializedSync();
  if (adapter) {
    const raw = adapter.extractHtmlModuleScripts(html);
    return JSON.parse(raw);
  }

  throw new Error('[@lit-core/ssr] Neither native addon nor Wasm compiler module is available to extract HTML module scripts.');
}
