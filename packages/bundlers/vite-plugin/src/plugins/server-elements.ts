import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import remapping from '@jridgewell/remapping';
import { compileHtmlAot } from '@lit-core/html-aot';
import { transformLitProps } from '@lit-core/props-lower';
import { HYDRATE_SUPPORT_SOURCE } from '@lit-core/resumable';
import { injectClientEntryImports, transformResumableComponent } from '@lit-core/resumable/compiler';
import { isViteClientEntryModule, resolveLitPrivateSsrSupportForVite, trackHtmlClientEntry } from '@lit-core/resumable/vite';
import { handleActionRequest } from '@lit-core/server-elements/action-endpoint';
import { type ActionMetadata, compileWorkerEntry, type LoaderMetadata, splitServerElement } from '@lit-core/server-split';
import { globSync } from 'tinyglobby';
import type { Plugin, ResolvedConfig, UserConfig, ViteDevServer } from 'vite';
import { reportTransformError } from '../errors.js';
import type { ServerElementsOptions } from '../options.js';
import { matchesPattern } from '../utils.js';
import { INSTALL_GLOBALS_SOURCE } from '../virtual.js';

const esmRequire = createRequire(import.meta.url);

export const LIT_SERVER_ELEMENTS_FAST_CHECK = /@(?:loader|action)\b|\bfrom\s*['"]@lit-core\/server-elements(?:['"]|\/)/;

const LIT_HTML_AOT_FAST_CHECK = /\b(?:html|svg)\s*`|\b[a-zA-Z0-9_$]+\.html\s*`|\bimport\b[^;]*\b(?:html|svg)\b|\b(?:static-html|lit-html\/(?:development\/)?static)\b/;

const LIT_DECORATOR_FAST_CHECK =
  /@(?:customElement|property|state|query|queryAll|queryAsync|queryAssignedElements|queryAssignedNodes|eventOptions|localized)\b|__(?:decorate|decorateClass)\b|\bimport\b[^;]*\b(?:decorators\.js|property|customElement|state)\b/;

const IGNORED_SCAN_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.lit-core', 'coverage', '.turbo']);

export interface DiscoveredServerElement {
  tagName?: string;
  className?: string;
  filePath: string;
  clientChunk?: string;
  serverChunk?: string;
  zeroLit: boolean;
  actions: ActionMetadata[];
  loaders: LoaderMetadata[];
}

function computeDeterministicBuildId(elements: DiscoveredServerElement[], explicitId?: string): string {
  if (explicitId) return explicitId;
  const hash = createHash('sha256');
  const sorted = [...elements].map((e) => e.tagName || e.filePath).sort();
  for (const s of sorted) hash.update(s);
  return hash.digest('hex').slice(0, 16);
}

interface WorkerWasmBuildState {
  needsRuntimeWasmFallback: boolean;
  emittedWorkerVirtualEntry: boolean;
}

function isRuntimeTemplateModuleId(cleanId: string): boolean {
  if (cleanId === 'lit/static-html' || cleanId === 'lit/static-html.js' || cleanId === 'lit-html/static' || cleanId === 'lit-html/static.js' || cleanId === 'lit-html/development/static.js') {
    return true;
  }
  const normalized = cleanId.replace(/\\/g, '/');
  return /(?:^|\/)lit(?:-html)?\/(?:development\/)?static(?:-html)?\.m?js$/.test(normalized);
}

function isVirtualWorkerInput(input: unknown): boolean {
  if (typeof input === 'string') {
    return input.includes('virtual:lit-core/worker');
  }
  if (Array.isArray(input)) {
    return input.some((item) => typeof item === 'string' && item.includes('virtual:lit-core/worker'));
  }
  if (input && typeof input === 'object') {
    return Object.values(input as Record<string, unknown>).some((val) => typeof val === 'string' && val.includes('virtual:lit-core/worker'));
  }
  return false;
}

function resolveSsrWasmBinaryPath(): string | null {
  try {
    if (typeof import.meta.resolve === 'function') {
      const resolvedUrl = import.meta.resolve('@lit-core/ssr');
      if (resolvedUrl.startsWith('file:')) {
        const candidate = path.resolve(path.dirname(fileURLToPath(resolvedUrl)), '../wasm/ssr_bg.wasm');
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  } catch {
    // Fall back to createRequire lookup below
  }
  try {
    const ssrEntry = esmRequire.resolve('@lit-core/ssr');
    const candidate = path.resolve(path.dirname(ssrEntry), '../wasm/ssr_bg.wasm');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  } catch {
    // Optional Wasm artifact lookup
  }
  return null;
}

export function generateWorkerEntryCode(options: { elements: DiscoveredServerElement[]; buildId?: string; actionRoutePrefix?: string; includeWasm?: boolean; additionalImports?: string[] }): string {
  const { elements, buildId = computeDeterministicBuildId(elements), actionRoutePrefix = '/_lit/a/', includeWasm, additionalImports } = options;
  return compileWorkerEntry({
    elements: elements.map((el) => ({
      tagName: el.tagName,
      className: el.className,
      filePath: el.filePath,
      actions: el.actions.map((act) => ({
        name: act.name,
        hash: act.hash,
      })),
    })),
    buildId,
    actionRoutePrefix,
    includeWasm,
    additionalImports,
  });
}

export function isSsrEnvironment(
  pluginCtx: { environment?: { name: string } },
  config: ResolvedConfig | undefined,
  transformOpts?: { ssr?: boolean },
  id?: string,
  targetOverride?: 'auto' | 'client' | 'worker' | 'server',
): boolean {
  // Query parameter overrides allow explicit artifact inspection and chained queries
  if (id) {
    if (/[?&]lit-client\b/.test(id)) return false;
    if (/[?&](?:lit-worker|lit-server|worker|ssr)\b/.test(id)) return true;
  }

  if (targetOverride && targetOverride !== 'auto') {
    return targetOverride === 'server' || targetOverride === 'worker';
  }

  // Vite 6 Environment API
  if (pluginCtx.environment) {
    return pluginCtx.environment.name !== 'client';
  }

  // Vite 5 / Rollup SSR transform flag
  if (transformOpts?.ssr === true) {
    return true;
  }

  // Vite build-level SSR configuration
  if (config?.build?.ssr) {
    return true;
  }

  return false;
}

/**
 * Server elements plugin.
 *
 * Worker and server targets cannot load the native template compiler at request time, so every
 * `html` template reachable from the server module graph, including third-party packages in
 * `node_modules`, is compiled ahead of time into SSR plans inside the same plugin pass. It does not
 * minify: the split pass computes client DOM addresses from the original template text, so the SSR
 * plan is built from that exact template text.
 */
export function serverElements(options: ServerElementsOptions = {}): Plugin[] {
  const wasmState: WorkerWasmBuildState = {
    needsRuntimeWasmFallback: false,
    emittedWorkerVirtualEntry: false,
  };
  return [serverElementsCore(options, wasmState)];
}

function serverElementsCore(options: ServerElementsOptions = {}, wasmState: WorkerWasmBuildState = { needsRuntimeWasmFallback: false, emittedWorkerVirtualEntry: false }): Plugin {
  let config: ResolvedConfig | undefined;
  let hasServerElements = false;
  let projectScanned = false;
  const discoveredElements = new Map<string, DiscoveredServerElement>();
  const discoveredClientCustomElementFiles = new Set<string>();
  const htmlEntryModules = new Set<string>();
  let hasSeenClientEntry = false;
  const actionIndex = new Map<string, { tag: string; filePath: string }>();

  function isExcludedByUserOptions(cleanId: string): boolean {
    if (options.exclude) {
      const excludes = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
      for (const pattern of excludes) {
        if (matchesPattern(cleanId, pattern)) return true;
      }
    }
    return false;
  }

  function isIncludedByUserOptions(cleanId: string): boolean {
    if (!options.include) return true;
    const includes = Array.isArray(options.include) ? options.include : [options.include];
    return includes.some((pattern) => matchesPattern(cleanId, pattern));
  }

  function lowerLitDecoratorsForServerSplit(sourceCode: string, safeFilename: string): string {
    if (!LIT_DECORATOR_FAST_CHECK.test(sourceCode)) {
      return sourceCode;
    }
    try {
      return transformLitProps(sourceCode, {
        sourcemap: false,
        filename: safeFilename,
      }).code;
    } catch {
      return sourceCode;
    }
  }

  function scanSourceDirectoryRecursive(dirPath: string): void {
    let matchedFiles: string[];
    try {
      matchedFiles = globSync(['**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'], {
        cwd: dirPath,
        absolute: true,
        ignore: ['**/*.d.ts', '**/*.{test,spec}.*', ...Array.from(IGNORED_SCAN_DIRS, (d) => `**/${d}/**`), '**/.wrangler/**'],
      });
    } catch {
      return;
    }

    const sortedFiles = [...matchedFiles].sort((a, b) => a.localeCompare(b));
    const actionRoutePrefix = options.actionRoutePrefix || '/_lit/a/';

    for (const fullPath of sortedFiles) {
      const normPath = fullPath.replace(/\\/g, '/');
      if (isExcludedByUserOptions(normPath) || !isIncludedByUserOptions(normPath)) {
        continue;
      }

      let rawCode: string;
      try {
        rawCode = fs.readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }

      if (LIT_SERVER_ELEMENTS_FAST_CHECK.test(rawCode)) {
        try {
          const codeForSplit = lowerLitDecoratorsForServerSplit(rawCode, normPath);
          const splitRes = splitServerElement(codeForSplit, {
            filename: normPath,
            sourcemap: false,
            actionRoutePrefix,
          });
          if (splitRes.isServerElement) {
            hasServerElements = true;
            if (!discoveredElements.has(normPath)) {
              discoveredElements.set(normPath, {
                tagName: splitRes.tagName,
                className: splitRes.className,
                filePath: normPath,
                zeroLit: Boolean(splitRes.zeroLit),
                actions: splitRes.actions,
                loaders: splitRes.loaders,
              });
            }
            if (splitRes.tagName) {
              for (const act of splitRes.actions) {
                actionIndex.set(act.hash, { tag: splitRes.tagName, filePath: normPath });
              }
            }
            continue;
          }
        } catch {
          // Defer syntax or isolation diagnostics to Rollup's main transform hook
        }
      }

      try {
        const resumableCheck = transformResumableComponent(rawCode, { filename: normPath });
        if (resumableCheck.transformed) {
          discoveredClientCustomElementFiles.add(normPath);
        }
      } catch {
        // Non-component module
      }
    }
  }

  function ensureProjectScanned(hintFilePath?: string): void {
    if (projectScanned) return;
    let scanRoot: string | null = null;
    if (config?.root) {
      const srcCandidate = path.join(config.root, 'src');
      if (fs.existsSync(srcCandidate)) {
        scanRoot = srcCandidate;
      } else if (fs.existsSync(config.root)) {
        scanRoot = config.root;
      }
    } else if (hintFilePath && path.isAbsolute(hintFilePath)) {
      const hintDir = path.dirname(hintFilePath);
      if (fs.existsSync(hintDir)) {
        scanRoot = hintDir;
      }
    }

    projectScanned = true;
    if (scanRoot) {
      scanSourceDirectoryRecursive(scanRoot);
    }
  }

  function compileSsrTemplatesIfNeeded(pluginCtx: any, sourceCode: string, cleanId: string, existingMap: any): { code: string; map: any } | null {
    if (options.target === 'client' || !LIT_HTML_AOT_FAST_CHECK.test(sourceCode)) {
      return null;
    }
    const safeFilename = cleanId.replace(/^\0/, '');
    try {
      const aotResult = compileHtmlAot(sourceCode, {
        filename: safeFilename,
        sourcemap: true,
        ssr: true,
        strictSsr: true,
      });
      if (aotResult.hasRuntimeTemplates) {
        wasmState.needsRuntimeWasmFallback = true;
      }
      if (aotResult.templatesCount === 0) {
        return null;
      }
      return {
        code: aotResult.code,
        map: aotResult.map ? JSON.parse(aotResult.map) : existingMap,
      };
    } catch (err) {
      reportTransformError(pluginCtx, 'html-aot', cleanId, err);
    }
  }

  function buildManifestObject(bundle?: Record<string, any>, pluginCtx?: { environment?: { name: string } }) {
    const rawElements: Record<string, any> = {};
    const rawActionsMap: Record<string, string> = {};

    const isServerEnvironment = Boolean((pluginCtx?.environment && pluginCtx.environment.name !== 'client') || config?.build?.ssr || options.target === 'server' || options.target === 'worker');

    const sortedEntries = Array.from(discoveredElements.values()).sort((a, b) => {
      const keyA = a.tagName || a.className || a.filePath;
      const keyB = b.tagName || b.className || b.filePath;
      return keyA.localeCompare(keyB);
    });

    for (const el of sortedEntries) {
      const tag = el.tagName || el.className || el.filePath;

      let clientChunk = el.clientChunk;
      let serverChunk = el.serverChunk;

      if (bundle) {
        for (const [fileName, chunk] of Object.entries(bundle)) {
          if (chunk && typeof chunk === 'object' && 'modules' in chunk) {
            const modules = Object.keys((chunk as any).modules || {});
            if (modules.includes(el.filePath)) {
              const isWorkerEntry = Boolean((chunk as any).facadeModuleId?.includes('virtual:lit-core/worker'));
              if (isServerEnvironment || isWorkerEntry) {
                serverChunk = fileName;
              } else {
                clientChunk = fileName;
              }
            }
          }
        }
      }

      const actionsObj: Record<string, any> = {};
      const sortedActions = [...el.actions].sort((a, b) => a.hash.localeCompare(b.hash));
      for (const act of sortedActions) {
        actionsObj[act.hash] = {
          name: act.name,
          writtenProperties: Array.isArray(act.writtenProperties) ? [...act.writtenProperties].sort() : [],
          params: act.params,
        };
        rawActionsMap[act.hash] = tag;
      }

      const loadersObj: Record<string, any> = {};
      const sortedLoaders = [...el.loaders].sort((a, b) => a.name.localeCompare(b.name));
      for (const load of sortedLoaders) {
        loadersObj[load.name] = {
          writtenProperties: Array.isArray(load.writtenProperties) ? [...load.writtenProperties].sort() : [],
        };
      }

      rawElements[tag] = {
        tagName: el.tagName,
        className: el.className,
        clientChunk: clientChunk || undefined,
        serverChunk: serverChunk || undefined,
        zeroLit: Boolean(el.zeroLit),
        actions: actionsObj,
        loaders: loadersObj,
      };
    }

    const sortedElementKeys = Object.keys(rawElements).sort();
    const elements: Record<string, any> = {};
    for (const k of sortedElementKeys) {
      elements[k] = rawElements[k];
    }

    const sortedActionHashes = Object.keys(rawActionsMap).sort();
    const actionsMap: Record<string, string> = {};
    for (const h of sortedActionHashes) {
      actionsMap[h] = rawActionsMap[h];
    }

    const manifestBuildId = computeDeterministicBuildId(sortedEntries, (options as any).buildId || (config?.env as any)?.LIT_BUILD_ID || (process.env as any)?.LIT_BUILD_ID);

    return {
      version: '1.0',
      buildId: manifestBuildId,
      elements,
      actionIndex: actionsMap,
    };
  }

  return {
    name: 'lit-server-elements',
    enforce: 'pre',

    config(userConfig: UserConfig) {
      const ssrIsVirtualWorker = typeof userConfig.build?.ssr === 'string' && isVirtualWorkerInput(userConfig.build.ssr);
      const targetsVirtualWorker = options.target === 'worker' || ssrIsVirtualWorker || isVirtualWorkerInput(userConfig.build?.rollupOptions?.input);
      if (!targetsVirtualWorker) {
        return undefined;
      }
      const patch: UserConfig = {};
      if (userConfig.ssr?.noExternal === undefined) {
        patch.ssr = {
          noExternal: true,
        };
      }
      if (ssrIsVirtualWorker && userConfig.build?.rollupOptions?.input === undefined) {
        patch.build = {
          ssr: true,
          rollupOptions: {
            input: 'virtual:lit-core/worker',
            ...(userConfig.build?.rollupOptions?.output === undefined ? { output: { codeSplitting: false } as any } : {}),
          },
        };
      }
      return patch;
    },

    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

    buildStart() {
      wasmState.needsRuntimeWasmFallback = false;
      wasmState.emittedWorkerVirtualEntry = false;
      hasSeenClientEntry = false;
      htmlEntryModules.clear();
    },

    resolveId(id, importer, resolveOpts) {
      if (id === 'lit-html/private-ssr-support.js') {
        const isSsr = isSsrEnvironment(this, config, resolveOpts, id, options.target);
        const conditions = config?.resolve?.conditions ?? [];
        const isDev = Boolean(conditions.includes('development') || (!conditions.includes('production') && config?.mode === 'development'));
        return resolveLitPrivateSsrSupportForVite(config?.root, isSsr, isDev, this as any, importer, resolveOpts as any);
      }
      const cleanId = id.split('?')[0];
      if (isRuntimeTemplateModuleId(cleanId) && isSsrEnvironment(this, config, resolveOpts, id, options.target)) {
        wasmState.needsRuntimeWasmFallback = true;
      }
      if (
        cleanId === 'virtual:lit-core/install-globals' ||
        cleanId === 'virtual:lit-core/install-globals.js' ||
        cleanId === '\0virtual:lit-core/install-globals' ||
        cleanId === '\0virtual:lit-core/install-globals.js'
      ) {
        return '\0virtual:lit-core/install-globals.js';
      }
      if (
        cleanId === 'virtual:lit-core/hydrate-support' ||
        cleanId === 'virtual:lit-core/hydrate-support.js' ||
        cleanId === '\0virtual:lit-core/hydrate-support' ||
        cleanId === '\0virtual:lit-core/hydrate-support.js' ||
        cleanId === 'virtual:lit-core/resumable-adapter' ||
        cleanId === 'virtual:lit-core/resumable-adapter.js' ||
        cleanId === '@lit-core/resumable/client' ||
        cleanId === '@lit-core/resumable/client.js'
      ) {
        return '\0virtual:lit-core/hydrate-support.js';
      }
      if (cleanId === 'virtual:lit-core/executor' || cleanId === 'virtual:lit-core/executor.js' || cleanId === '\0virtual:lit-core/executor' || cleanId === '\0virtual:lit-core/executor.js') {
        return '\0virtual:lit-core/executor.js';
      }
      if (
        cleanId === 'virtual:lit-core/manifest' ||
        cleanId === 'virtual:lit-core/manifest.js' ||
        cleanId === 'virtual:lit-core/manifest.json' ||
        cleanId === '\0virtual:lit-core/manifest' ||
        cleanId === '\0virtual:lit-core/manifest.js'
      ) {
        return '\0virtual:lit-core/manifest.js';
      }
      const normalizedCleanId = cleanId.replace(/\\/g, '/');
      if (
        cleanId === 'virtual:lit-core/worker' ||
        cleanId === 'virtual:lit-core/worker.js' ||
        cleanId === '\0virtual:lit-core/worker' ||
        cleanId === '\0virtual:lit-core/worker.js' ||
        normalizedCleanId.endsWith('/virtual:lit-core/worker') ||
        normalizedCleanId.endsWith('/virtual:lit-core/worker.js')
      ) {
        return '\0virtual:lit-core/worker.js';
      }
      if (
        cleanId === './ssr_bg.wasm' &&
        (importer === '\0virtual:lit-core/worker.js' || importer === '\0virtual:lit-core/worker' || isSsrEnvironment(this, config, resolveOpts, importer, options.target))
      ) {
        wasmState.needsRuntimeWasmFallback = true;
        return { id: './ssr_bg.wasm', external: true };
      }
      const tracked = trackHtmlClientEntry(this as any, config?.root, htmlEntryModules, id, importer, resolveOpts as any);
      if (tracked) {
        return tracked.then(() => null);
      }
      return null;
    },

    moduleParsed(moduleInfo) {
      const isWorkerOrServer =
        wasmState.emittedWorkerVirtualEntry ||
        options.target === 'worker' ||
        options.target === 'server' ||
        Boolean((this as any)?.environment && (this as any).environment.name !== 'client') ||
        Boolean(config?.build?.ssr);
      if (!isWorkerOrServer) return;
      const cleanId = moduleInfo.id.split('?')[0] ?? moduleInfo.id;
      if (isRuntimeTemplateModuleId(cleanId)) {
        wasmState.needsRuntimeWasmFallback = true;
      }
    },

    load(id) {
      if (id === '\0virtual:lit-core/install-globals.js' || id === '\0virtual:lit-core/install-globals') {
        return INSTALL_GLOBALS_SOURCE;
      }
      if (id === '\0virtual:lit-core/hydrate-support.js' || id === '\0virtual:lit-core/hydrate-support') {
        return HYDRATE_SUPPORT_SOURCE;
      }
      if (id === '\0virtual:lit-core/executor.js' || id === '\0virtual:lit-core/executor') {
        return "export * from '@lit-core/server-elements/executor';";
      }
      if (id === '\0virtual:lit-core/manifest.js' || id === '\0virtual:lit-core/manifest') {
        if (discoveredElements.size === 0 && config?.root) {
          ensureProjectScanned();
        }
        return `export default ${JSON.stringify(buildManifestObject())};`;
      }
      if (id === '\0virtual:lit-core/worker.js' || id === '\0virtual:lit-core/worker') {
        wasmState.emittedWorkerVirtualEntry = true;
        if (config?.root) {
          ensureProjectScanned();
        }
        const sortedEntries = Array.from(discoveredElements.values());
        const additionalImports = Array.from(discoveredClientCustomElementFiles)
          .filter((file) => !discoveredElements.has(file))
          .sort();
        const workerBuildId = computeDeterministicBuildId(sortedEntries, (options as any).buildId || (config?.env as any)?.LIT_BUILD_ID || (process.env as any)?.LIT_BUILD_ID);
        const pluginCtx = this as any;
        if (typeof pluginCtx?.load !== 'function') {
          return generateWorkerEntryCode({
            elements: sortedEntries,
            buildId: workerBuildId,
            actionRoutePrefix: options.actionRoutePrefix || '/_lit/a/',
            includeWasm: wasmState.needsRuntimeWasmFallback,
            additionalImports: additionalImports.length > 0 ? additionalImports : undefined,
          });
        }
        return (async () => {
          const queue: string[] = [...sortedEntries.map((el) => el.filePath).filter(Boolean), ...additionalImports];
          const visited = new Set<string>(['\0virtual:lit-core/worker.js', '\0virtual:lit-core/worker']);
          while (queue.length > 0 && !wasmState.needsRuntimeWasmFallback) {
            const nextId = queue.shift();
            if (!nextId || visited.has(nextId)) continue;
            visited.add(nextId);
            try {
              const info = await pluginCtx.load({ id: nextId });
              if (info?.importedIds) {
                for (const depId of info.importedIds) {
                  if (!visited.has(depId) && !depId.startsWith('\0virtual:lit-core/')) {
                    queue.push(depId);
                  }
                }
              }
              if (info?.dynamicallyImportedIds) {
                for (const dynId of info.dynamicallyImportedIds) {
                  if (!visited.has(dynId) && !dynId.startsWith('\0virtual:lit-core/')) {
                    queue.push(dynId);
                  }
                }
              }
            } catch {
              // Defer resolution diagnostics to Rollup's main graph traversal
            }
          }
          return generateWorkerEntryCode({
            elements: sortedEntries,
            buildId: workerBuildId,
            actionRoutePrefix: options.actionRoutePrefix || '/_lit/a/',
            includeWasm: wasmState.needsRuntimeWasmFallback,
            additionalImports: additionalImports.length > 0 ? additionalImports : undefined,
          });
        })();
      }
      return null;
    },

    transform(code: string, id: string, transformOpts?: { ssr?: boolean }) {
      const cleanId = id.split('?')[0] ?? id;
      if (!/\.[cm]?[jt]sx?$/.test(cleanId) || cleanId.startsWith('\0virtual:lit-core/') || cleanId.startsWith('\0virtual:css-fuse/') || cleanId.startsWith('\0virtual:html-fuse/')) {
        return null;
      }

      if (isExcludedByUserOptions(cleanId)) {
        return null;
      }

      const isSsr = isSsrEnvironment(this, config, transformOpts, id, options.target);

      const maybeInjectLitHydrateHook = (sourceCode: string): { code: string; map: any } | null => {
        if (isSsr || !hasSeenClientEntry || !options.autoInjectHydrate || !sourceCode.includes('litElementHydrateSupport') || cleanId.includes('hydrate-core')) {
          return null;
        }
        const injected = injectClientEntryImports(sourceCode, ['virtual:lit-core/hydrate-support'], {
          filename: cleanId.replace(/^\0/, ''),
          sourcemap: true,
        });
        if (!injected.transformed) return null;
        return {
          code: injected.code,
          map: injected.map ? JSON.parse(injected.map) : null,
        };
      };

      if (!options.include && cleanId.includes('/node_modules/')) {
        if (isSsr) {
          return compileSsrTemplatesIfNeeded(this, code, cleanId, null);
        }
        return maybeInjectLitHydrateHook(code);
      }

      if (!isIncludedByUserOptions(cleanId)) {
        return null;
      }

      const isClientEntry = !isSsr && !cleanId.includes('/node_modules/') && isViteClientEntryModule(this, id, cleanId, htmlEntryModules);
      if (isClientEntry) {
        hasSeenClientEntry = true;
      }

      const maybeInjectEntryImports = (sourceCode: string, includeExecutor: boolean): { code: string; map: any } | null => {
        const hydrateHook = maybeInjectLitHydrateHook(sourceCode);
        if (!isClientEntry) return hydrateHook;
        let shouldIncludeExecutor = includeExecutor;
        if (!shouldIncludeExecutor && options.autoInjectExecutor !== false) {
          ensureProjectScanned(cleanId);
          shouldIncludeExecutor = hasServerElements;
        }
        const specifiers: string[] = [];
        if (hydrateHook) {
          specifiers.push('virtual:lit-core/hydrate-support');
        }
        if (shouldIncludeExecutor && options.autoInjectExecutor !== false) {
          specifiers.push('@lit-core/server-elements/executor');
        }
        if (specifiers.length === 0) return null;
        const injected = injectClientEntryImports(sourceCode, specifiers, {
          filename: cleanId.replace(/^\0/, ''),
          sourcemap: true,
        });
        if (!injected.transformed) return null;
        return {
          code: injected.code,
          map: injected.map ? JSON.parse(injected.map) : null,
        };
      };

      if (!LIT_SERVER_ELEMENTS_FAST_CHECK.test(code)) {
        if (isSsr) {
          return compileSsrTemplatesIfNeeded(this, code, cleanId, null);
        }
        return maybeInjectEntryImports(code, hasServerElements);
      }

      try {
        const safeFilename = cleanId.replace(/^\0/, '');
        const actionRoutePrefix = options.actionRoutePrefix || '/_lit/a/';
        const codeForSplit = lowerLitDecoratorsForServerSplit(code, safeFilename);
        const result = splitServerElement(codeForSplit, {
          filename: safeFilename,
          sourcemap: true,
          actionRoutePrefix,
        });

        if (result.hasErrors) {
          const errorDiag = result.diagnostics.find((d) => d.severity === 'error' && (result.zeroLit || d.code !== 'SE106'));
          if (errorDiag) {
            const msg = `[${errorDiag.code}] ${errorDiag.message}`;
            reportTransformError(this, 'server-elements', cleanId, new Error(msg));
          }
        }

        if (!result.isServerElement) {
          if (isSsr) {
            return compileSsrTemplatesIfNeeded(this, code, cleanId, null);
          }
          return maybeInjectEntryImports(code, hasServerElements);
        }

        hasServerElements = true;
        const isZeroLit = Boolean(result.zeroLit);
        const elementInfo: DiscoveredServerElement = {
          tagName: result.tagName,
          className: result.className,
          filePath: cleanId,
          zeroLit: isZeroLit,
          actions: result.actions,
          loaders: result.loaders,
        };
        discoveredElements.set(cleanId, elementInfo);

        if (result.tagName) {
          for (const act of result.actions) {
            actionIndex.set(act.hash, { tag: result.tagName, filePath: cleanId });
          }
        }

        let selectedCode = isSsr ? result.workerCode : result.clientCode;
        let selectedMap: any = isSsr ? result.workerMap : result.clientMap;
        if (typeof selectedMap === 'string') {
          selectedMap = JSON.parse(selectedMap);
        }

        if (isSsr) {
          const aotCompiled = compileSsrTemplatesIfNeeded(this, selectedCode, cleanId, selectedMap);
          if (aotCompiled) {
            selectedCode = aotCompiled.code;
            if (aotCompiled.map && selectedMap) {
              try {
                selectedMap = remapping([aotCompiled.map as any, selectedMap as any], () => null);
              } catch {
                selectedMap = aotCompiled.map;
              }
            } else {
              selectedMap = aotCompiled.map ?? selectedMap;
            }
          }
        } else {
          const injectedEntry = maybeInjectEntryImports(selectedCode, true);
          if (injectedEntry) {
            selectedCode = injectedEntry.code;
            if (injectedEntry.map && selectedMap) {
              try {
                selectedMap = remapping([injectedEntry.map as any, selectedMap as any], () => null);
              } catch {
                selectedMap = injectedEntry.map;
              }
            } else {
              selectedMap = injectedEntry.map ?? selectedMap;
            }
          }
        }

        return {
          code: selectedCode,
          map: selectedMap ?? null,
        };
      } catch (err) {
        reportTransformError(this, 'server-elements', cleanId, err);
      }
    },

    transformIndexHtml(html: string, ctx?: any) {
      const isProductionBuild = Boolean(ctx?.bundle || config?.command === 'build');
      if (isProductionBuild) {
        return html;
      }
      const scripts: string[] = [];
      if (options.autoInjectHydrate) {
        scripts.push('<script type="module" src="/@id/__x00__virtual:lit-core/hydrate-support.js"></script>');
      }
      if (hasServerElements && options.autoInjectExecutor !== false) {
        scripts.push('<script type="module" src="/@id/__x00__virtual:lit-core/executor.js"></script>');
      }
      if (scripts.length === 0) {
        return html;
      }
      const block = scripts.map((s) => `  ${s}`).join('\n');
      if (/<\/head>/i.test(html)) {
        return html.replace(/<\/head>/i, `${block}\n</head>`);
      }
      return `${scripts.join('\n')}\n${html}`;
    },

    configureServer(server: ViteDevServer) {
      const rawRoutePrefix = options.actionRoutePrefix || '/_lit/a/';
      const routePrefix = rawRoutePrefix.endsWith('/') ? rawRoutePrefix : `${rawRoutePrefix}/`;
      const devSecret = options.secret || 'lit-dev-insecure-secret-key-32b!';

      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'POST' || !req.url) {
          return next();
        }

        const urlPath = req.url.split('?')[0];
        if (!urlPath.startsWith(routePrefix)) {
          return next();
        }

        const actionHash = req.url.slice(routePrefix.length).split('?')[0].replace(/\/$/, '');
        if (!actionHash || !/^[0-9a-f]{16}$/i.test(actionHash)) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ error: 'Invalid action hash format', code: 'INVALID_HASH' }));
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
          }
          const rawBody = Buffer.concat(chunks).toString('utf-8');

          const rawProto = req.headers['x-forwarded-proto'];
          const forwardedProto = Array.isArray(rawProto) ? rawProto[0] : rawProto;
          const protocol = forwardedProto ? (forwardedProto.split(',')[0].trim().toLowerCase() === 'https' ? 'https' : 'http') : (req.socket as any)?.encrypted ? 'https' : 'http';
          const host = req.headers.host || 'localhost:5173';
          const fullUrl = new URL(req.url, `${protocol}://${host}`);

          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (v !== undefined) {
              if (Array.isArray(v)) {
                for (const item of v) headers.append(k, item);
              } else {
                headers.set(k, v);
              }
            }
          }

          const webRequest = new Request(fullUrl.toString(), {
            method: 'POST',
            headers,
            body: rawBody,
          });

          const actionMeta = actionIndex.get(actionHash);
          if (actionMeta) {
            await server.ssrLoadModule(actionMeta.filePath);
          }

          const webResponse = await handleActionRequest(webRequest, {
            env: (server.config as any)?.env || {},
            secret: devSecret,
            registry: (globalThis as any).customElements,
            routePrefix,
          });

          res.statusCode = webResponse.status;
          webResponse.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });

          if (webResponse.body) {
            const reader = webResponse.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) res.write(value);
            }
            res.end();
          } else {
            const buffer = await webResponse.arrayBuffer();
            res.end(Buffer.from(buffer));
          }
        } catch (err: any) {
          if (typeof server.ssrFixStacktrace === 'function') {
            server.ssrFixStacktrace(err);
          }
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err?.message || 'Internal action execution error' }));
          } else {
            res.end();
          }
        }
      });
    },

    generateBundle: {
      order: 'post',
      handler(_outputOptions, bundle) {
        if (options.emitManifest !== false && hasServerElements) {
          const manifest = buildManifestObject(bundle as Record<string, any>, this);
          const manifestJson = JSON.stringify(manifest, null, 2);
          this.emitFile({
            type: 'asset',
            fileName: 'lit-manifest.json',
            source: manifestJson,
          });
          this.emitFile({
            type: 'asset',
            fileName: '.lit-core/server-manifest.json',
            source: manifestJson,
          });
        }

        const isWorkerOrServer =
          wasmState.emittedWorkerVirtualEntry ||
          options.target === 'worker' ||
          options.target === 'server' ||
          Boolean((this as any)?.environment && (this as any).environment.name !== 'client') ||
          Boolean(config?.build?.ssr);

        if (isWorkerOrServer && wasmState.needsRuntimeWasmFallback && !(bundle as Record<string, unknown>)['ssr_bg.wasm']) {
          const wasmPath = resolveSsrWasmBinaryPath();
          if (wasmPath) {
            this.emitFile({
              type: 'asset',
              fileName: 'ssr_bg.wasm',
              source: fs.readFileSync(wasmPath),
            });
          }
        }
      },
    },
  };
}

export const litServerElements = serverElements;
