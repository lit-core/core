import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { compileResumableLoader, injectClientEntryImports } from '../compiler/index.js';
import { HYDRATE_SUPPORT_SOURCE } from '../virtual.js';
import { buildManifest, extractCustomElementTags } from './manifest.js';

const esmRequire = createRequire(import.meta.url);

function findPackageDirFromEntry(entryFile: string): string {
  let dir = path.dirname(entryFile);
  while (dir !== path.dirname(dir) && !fs.existsSync(path.join(dir, 'package.json'))) {
    dir = path.dirname(dir);
  }
  return dir;
}

function resolveLitPrivateSsrSupportStatic(rootDir: string | undefined, isSsr: boolean, isDev: boolean): string | undefined {
  const candidates: NodeRequire[] = [];
  if (rootDir) {
    const rootPkg = path.join(rootDir, 'package.json');
    if (fs.existsSync(rootPkg)) {
      candidates.push(createRequire(rootPkg));
    }
  }
  candidates.push(esmRequire);

  const subPath = isSsr
    ? isDev
      ? path.join('node', 'development', 'private-ssr-support.js')
      : path.join('node', 'private-ssr-support.js')
    : isDev
      ? path.join('development', 'private-ssr-support.js')
      : 'private-ssr-support.js';

  for (const req of candidates) {
    try {
      const litEntry = req.resolve('lit');
      const litRequire = createRequire(litEntry);
      const litHtmlDir = findPackageDirFromEntry(litRequire.resolve('lit-html'));
      const candidate = path.join(litHtmlDir, subPath);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {}
    try {
      const litHtmlDir = findPackageDirFromEntry(req.resolve('lit-html'));
      const candidate = path.join(litHtmlDir, subPath);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {}
  }

  return undefined;
}

export function resolveLitPrivateSsrSupportForVite(rootDir: string | undefined, isSsr: boolean, isDev: boolean): string | undefined;
export function resolveLitPrivateSsrSupportForVite(
  rootDir: string | undefined,
  isSsr: boolean,
  isDev: boolean,
  pluginCtx?: {
    resolve?: (source: string, importer?: string, options?: { skipSelf?: boolean } & Record<string, unknown>) => Promise<{ id: string; external?: boolean | 'absolute' | 'relative' } | null>;
    environment?: { config?: { resolve?: { conditions?: readonly string[] } } };
  },
  importer?: string,
  resolveOpts?: Record<string, unknown>,
): string | Promise<string | undefined> | undefined;
export function resolveLitPrivateSsrSupportForVite(
  rootDir: string | undefined,
  isSsr: boolean,
  isDev: boolean,
  pluginCtx?: {
    resolve?: (source: string, importer?: string, options?: { skipSelf?: boolean } & Record<string, unknown>) => Promise<{ id: string; external?: boolean | 'absolute' | 'relative' } | null>;
    environment?: { config?: { resolve?: { conditions?: readonly string[] } } };
  },
  importer?: string,
  resolveOpts?: Record<string, unknown>,
): string | Promise<string | undefined> | undefined {
  if (typeof pluginCtx?.resolve === 'function') {
    const resolveFn = pluginCtx.resolve.bind(pluginCtx);
    const opts = { ...resolveOpts, skipSelf: true };
    const cleanImporter = importer && !importer.startsWith('\0') ? importer.split('?')[0] : rootDir ? path.join(rootDir, '_lit_resolve_.js') : undefined;

    return (async () => {
      let litHtmlResolved = await resolveFn('lit-html', cleanImporter, opts);
      if (!litHtmlResolved?.id || litHtmlResolved.external) {
        const litFacade = (await resolveFn('lit/html.js', cleanImporter, opts)) ?? (await resolveFn('lit', cleanImporter, opts));
        if (litFacade?.id && !litFacade.external) {
          litHtmlResolved = await resolveFn('lit-html', litFacade.id.split('?')[0], opts);
        }
      }
      if (litHtmlResolved?.id && !litHtmlResolved.external) {
        const sibling = path.join(path.dirname(litHtmlResolved.id.split('?')[0]), 'private-ssr-support.js');
        if (fs.existsSync(sibling)) {
          return sibling;
        }
      }
      const envConditions = pluginCtx?.environment?.config?.resolve?.conditions;
      const effectiveDev = Array.isArray(envConditions) && envConditions.length > 0 ? envConditions.includes('development') || (envConditions.includes('development|production') && isDev) : isDev;
      return resolveLitPrivateSsrSupportStatic(rootDir, isSsr, effectiveDev);
    })();
  }
  return resolveLitPrivateSsrSupportStatic(rootDir, isSsr, isDev);
}

export function trackHtmlClientEntry(
  pluginCtx:
    | {
        resolve?: (source: string, importer?: string, options?: { skipSelf?: boolean } & Record<string, unknown>) => Promise<{ id: string; external?: boolean | 'absolute' | 'relative' } | null>;
      }
    | undefined,
  rootDir: string | undefined,
  htmlEntries: Set<string>,
  id: string,
  importer: string | undefined,
  resolveOpts?: Record<string, unknown>,
): Promise<undefined> | undefined {
  if (!importer) return undefined;
  const cleanImporter = importer.split('?')[0].replace(/\\/g, '/');
  if (!cleanImporter.endsWith('.html')) return undefined;
  const cleanSource = id.split('?')[0];
  if (!cleanSource || cleanSource.startsWith('\0') || cleanSource.startsWith('vite/') || id.includes('?html-proxy')) {
    return undefined;
  }
  if (cleanSource.startsWith('/') && rootDir) {
    htmlEntries.add(path.resolve(rootDir, cleanSource.slice(1)).replace(/\\/g, '/'));
  } else if (cleanSource.startsWith('.')) {
    htmlEntries.add(path.resolve(path.dirname(cleanImporter), cleanSource).replace(/\\/g, '/'));
  }
  if (typeof pluginCtx?.resolve === 'function') {
    return pluginCtx.resolve(id, importer, { ...resolveOpts, skipSelf: true }).then((resolved) => {
      if (resolved?.id && !resolved.external) {
        htmlEntries.add(resolved.id.split('?')[0].replace(/\\/g, '/'));
      }
      return undefined;
    });
  }
  return undefined;
}

export function isViteClientEntryModule(
  pluginCtx: { getModuleInfo?: (id: string) => { isEntry?: boolean; importers?: readonly string[] } | null } | undefined,
  id: string,
  cleanId: string,
  htmlEntries?: ReadonlySet<string>,
): boolean {
  const normalizedCleanId = cleanId.replace(/\\/g, '/');
  if (htmlEntries?.has(normalizedCleanId)) {
    return true;
  }
  const info = pluginCtx?.getModuleInfo?.(id) ?? pluginCtx?.getModuleInfo?.(cleanId);
  if (!info) return false;
  if (info.isEntry) return !normalizedCleanId.endsWith('.html');
  return Array.isArray(info.importers) && info.importers.length > 0 && info.importers.every((imp) => imp.split('?')[0].endsWith('.html'));
}

export interface ResumableOptions {
  /**
   * Include glob patterns for resumable components.
   */
  include?: string[];

  /**
   * Exclude glob patterns.
   */
  exclude?: string[];

  /**
   * Preload component chunks on idle or hover.
   * @default true
   */
  preloadOnHover?: boolean;

  /**
   * Custom chunk URL resolver.
   */
  chunkResolver?: (tagName: string) => string;

  /**
   * Automatically inject `virtual:lit-core/hydrate-support` into client entry modules.
   * @default true
   */
  injectAdapter?: boolean;

  /**
   * Eagerly load remaining component chunks during browser idle time.
   * Off by default so chunks only load on interaction or hover intent.
   * @default false
   */
  idleHydration?: boolean;

  /**
   * Idle callback deadline in milliseconds when `idleHydration` is enabled.
   * @default 2000
   */
  idleTimeout?: number;

  /**
   * Interaction events intercepted by the micro-loader.
   */
  events?: string[];
}

const VIRTUAL_HYDRATE_ID = 'virtual:lit-core/hydrate-support';
const VIRTUAL_ADAPTER_ID = 'virtual:lit-core/resumable-adapter';
const RESOLVED_VIRTUAL_HYDRATE_ID = '\0virtual:lit-core/hydrate-support.js';

export function resumable(options: ResumableOptions = {}): Plugin {
  let config: ResolvedConfig;
  const chunkToTags = new Map<string, string[]>();
  const moduleTags = new Map<string, string[]>();
  const htmlEntryModules = new Set<string>();
  let manifest: Record<string, string> = {};

  // Maps each emitted chunk file to the custom element tags it defines, using both the
  // tags seen per source module and the tags found in the emitted chunk code.
  const tagsByChunk = (bundle: Record<string, { type: string }>): Map<string, string[]> => {
    const result = new Map<string, string[]>();
    for (const [fileName, output] of Object.entries(bundle)) {
      if (output.type !== 'chunk') continue;
      const chunk = output as unknown as { code: string; moduleIds?: string[] };
      const tags = new Set<string>(extractCustomElementTags(chunk.code));
      for (const id of chunk.moduleIds ?? []) {
        for (const tag of moduleTags.get(id.split('?')[0]) ?? []) tags.add(tag);
      }
      if (tags.size > 0) result.set(fileName, [...tags]);
    }
    return result;
  };

  const { preloadOnHover = true, chunkResolver, injectAdapter = true, idleHydration, idleTimeout, events } = options;

  return {
    name: 'lit-resumable',
    enforce: 'post',

    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

    buildStart() {
      htmlEntryModules.clear();
    },

    resolveId(id, importer, resolveOpts) {
      if (id === 'lit-html/private-ssr-support.js') {
        const isSsr = Boolean(resolveOpts?.ssr || config?.build?.ssr);
        const conditions = config?.resolve?.conditions ?? [];
        const isDev = Boolean(conditions.includes('development') || (!conditions.includes('production') && config?.mode === 'development'));
        return resolveLitPrivateSsrSupportForVite(config?.root, isSsr, isDev, this as any, importer, resolveOpts as any);
      }
      if (
        id === VIRTUAL_HYDRATE_ID ||
        id === `${VIRTUAL_HYDRATE_ID}.js` ||
        id === VIRTUAL_ADAPTER_ID ||
        id === `${VIRTUAL_ADAPTER_ID}.js` ||
        id === '@lit-core/resumable/client' ||
        id === '@lit-core/resumable/client.js'
      ) {
        return RESOLVED_VIRTUAL_HYDRATE_ID;
      }
      if (importer?.startsWith('\0virtual:lit-core/') && !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0') && !id.startsWith('virtual:')) {
        if (config?.root) {
          try {
            const rootReq = createRequire(path.join(config.root, 'package.json'));
            return rootReq.resolve(id);
          } catch {}
        }
        try {
          return esmRequire.resolve(id);
        } catch {}
      }
      return trackHtmlClientEntry(this as any, config?.root, htmlEntryModules, id, importer, resolveOpts as any);
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_HYDRATE_ID) {
        return {
          code: HYDRATE_SUPPORT_SOURCE,
          map: null,
        };
      }
      return undefined;
    },

    transform(code: string, id: string, transformOpts?: { ssr?: boolean }) {
      const cleanId = id.split('?')[0];
      if (!/\.[cm]?[jt]sx?$/.test(cleanId) || cleanId.startsWith('\0virtual:lit-core/') || cleanId.startsWith('\0virtual:css-fuse/') || cleanId.startsWith('\0virtual:html-fuse/')) {
        return null;
      }

      if (!cleanId.startsWith('\0') && !cleanId.includes('/node_modules/')) {
        const tags = extractCustomElementTags(code);
        if (tags.length > 0) {
          const relativeId = cleanId.replace(config?.root || '', '');
          chunkToTags.set(relativeId, tags);
          moduleTags.set(cleanId, tags);
        }
      }

      const isSsr = Boolean(transformOpts?.ssr || config?.build?.ssr);
      if (!isSsr && injectAdapter && !cleanId.includes('/node_modules/') && isViteClientEntryModule(this, id, cleanId, htmlEntryModules)) {
        const injected = injectClientEntryImports(code, [VIRTUAL_HYDRATE_ID], {
          filename: cleanId.replace(/^\0/, ''),
          sourcemap: true,
        });
        if (injected.transformed) {
          return {
            code: injected.code,
            map: injected.map ? JSON.parse(injected.map) : null,
          };
        }
      }

      return null;
    },

    generateBundle(_outputOptions, bundle) {
      chunkToTags.clear();
      for (const [fileName, tags] of tagsByChunk(bundle)) {
        chunkToTags.set(fileName, tags);
      }

      manifest = buildManifest(chunkToTags, {
        chunkResolver,
        basePath: config?.base || '/',
      });
    },

    transformIndexHtml: {
      order: 'post',
      handler(html: string, ctx) {
        if (ctx?.bundle) {
          manifest = buildManifest(tagsByChunk(ctx.bundle), {
            chunkResolver,
            basePath: config?.base || '/',
          });
        } else if (Object.keys(manifest).length === 0 && chunkToTags.size > 0) {
          manifest = buildManifest(chunkToTags, {
            chunkResolver,
            basePath: config?.base || '/',
          });
        }

        const loaderScript = compileResumableLoader({ manifest, preloadOnHover, idleHydration, idleTimeout, events });
        const injection = `<script>${loaderScript}</script>`;

        if (html.includes('</head>')) {
          return html.replace('</head>', `${injection}\n</head>`);
        }
        if (html.includes('<body')) {
          return html.replace('<body', `${injection}\n<body`);
        }
        return `${injection}\n${html}`;
      },
    },
  };
}

export { buildManifest, extractCustomElementTags } from './manifest.js';
export const litResumable = resumable;
export default resumable;
