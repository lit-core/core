import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { HYDRATE_SUPPORT_SOURCE, RESUMABLE_ADAPTER_SOURCE } from '@lit-core/resumable';
import { injectClientEntryImports } from '@lit-core/resumable/compiler';
import { isViteClientEntryModule, resolveLitPrivateSsrSupportForVite, trackHtmlClientEntry } from '@lit-core/resumable/vite';
import {
  collectResult,
  createIsolateEnvironment,
  extractHtmlModuleScripts,
  IsolateCustomElementRegistry,
  renderHtmlDocument,
  renderToString,
  transformSsrComponent,
  withScopedIsolateGlobals,
} from '@lit-core/ssr';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { reportTransformError } from '../errors.js';
import type { SsrOptions } from '../options.js';
import { formatVirtualLitCoreId, isVirtualLitCoreId, matchesPattern } from '../utils.js';
import { getIslandsLoaderSource, INSTALL_GLOBALS_SOURCE, SSR_RUNTIME_SOURCE } from '../virtual.js';

export const LIT_SSR_FAST_CHECK = /(?:@customElement|customElements\.define|LitElement|ReactiveElement|HTMLElement|html`|css`)/;

/**
 * Normalizes an arbitrary prerender route into a valid, canonical HTML bundle asset path.
 * Returns null if the input is not a valid string.
 */
export function sanitizePrerenderRoute(route: unknown): string | null {
  if (typeof route !== 'string') {
    return null;
  }

  const withoutQuery = (route.split('?')[0] ?? '').split('#')[0] ?? '';
  const collapsed = withoutQuery.trim().replace(/\/+/g, '/');
  const trimmed = collapsed.replace(/^\/+|\/+$/g, '');

  if (trimmed === '' || trimmed === 'index') {
    return 'index.html';
  }

  if (trimmed.endsWith('.html')) {
    return trimmed;
  }

  return `${trimmed}.html`;
}

function extractModuleScriptSrcs(html: string): string[] {
  const rawSrcs = extractHtmlModuleScripts(html);
  return rawSrcs.filter((src) => src && !src.startsWith('/@vite/') && !src.startsWith('http://') && !src.startsWith('https://'));
}

function injectHeadOrBodyScript(html: string, scriptTag: string): string {
  const lower = html.toLowerCase();
  const headCloseIdx = lower.indexOf('</head>');
  if (headCloseIdx !== -1) {
    return `${html.slice(0, headCloseIdx)}  ${scriptTag}\n${html.slice(headCloseIdx)}`;
  }
  const bodyCloseIdx = lower.indexOf('</body>');
  if (bodyCloseIdx !== -1) {
    return `${html.slice(0, bodyCloseIdx)}  ${scriptTag}\n${html.slice(bodyCloseIdx)}`;
  }
  return `${scriptTag}${html}`;
}

/**
 * Renders custom element tags in an HTML string into genuine Declarative Shadow DOM
 * using @lit-core/ssr without regex HTML rewriting or global prototype pollution.
 */
export function transformHtmlWithSsr(html: string, options: SsrOptions & { islandsManifest?: Record<string, string> } = {}): string {
  if (typeof html !== 'string' || html.length === 0) {
    return html;
  }

  const preExistingCustomElements = (globalThis as any).customElements;

  return withScopedIsolateGlobals((scopedEnv) => {
    const baseRegistry = options.customElements ?? preExistingCustomElements ?? scopedEnv.customElements;
    const registry = new IsolateCustomElementRegistry(baseRegistry);
    const domPaths = Boolean(options.domPaths);
    const resumable = Boolean(options.resumable);
    const islands = Boolean(options.islands);

    let renderedHtml = renderHtmlDocument(html, {
      customElements: registry,
      domPaths,
      resumable,
      mode: 'dsd',
    });

    if (options.islandsManifest && Object.keys(options.islandsManifest).length > 0 && !renderedHtml.includes('__LIT_ISLANDS_MANIFEST__')) {
      const manifestJson = JSON.stringify(options.islandsManifest).replace(/</g, '\\u003c');
      const manifestScript = `<script>window.__LIT_ISLANDS_MANIFEST__=${manifestJson};</script>`;
      renderedHtml = injectHeadOrBodyScript(renderedHtml, manifestScript);
    }

    if (islands && !renderedHtml.includes('islands-loader')) {
      const islandScript = '<script type="module" src="/@id/__x00__virtual:lit-core/islands-loader.js"></script>';
      renderedHtml = injectHeadOrBodyScript(renderedHtml, islandScript);
    }

    return renderedHtml;
  });
}

const STATIC_ASSET_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.jsx',
  '.tsx',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.tiff',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.wasm',
  '.map',
  '.json',
  '.webmanifest',
  '.mp4',
  '.webm',
  '.ogg',
  '.mp3',
  '.wav',
  '.flac',
  '.aac',
  '.pdf',
  '.zip',
  '.gz',
  '.br',
]);

function isStaticAssetRequest(url: string): boolean {
  if (url.startsWith('/@') || url.startsWith('/__')) {
    return true;
  }
  const pathname = (url.split('?')[0] ?? '').split('#')[0] ?? '';
  const ext = path.extname(pathname).toLowerCase();
  return ext !== '' && STATIC_ASSET_EXTENSIONS.has(ext);
}

/**
 * First-class server-side rendering sub-plugin for @lit-core/vite-plugin.
 */
export function ssr(options: SsrOptions = {}): Plugin {
  let config: ResolvedConfig | undefined;
  let isServerBuild = false;
  const moduleTagsMap = new Map<string, string[]>();
  const htmlEntryModules = new Set<string>();
  const pluginIsolateEnv = createIsolateEnvironment();

  return {
    name: 'lit-ssr',
    enforce: 'post',

    configResolved(resolvedConfig) {
      config = resolvedConfig;
      isServerBuild = Boolean(config.build?.ssr);
    },

    buildStart() {
      htmlEntryModules.clear();
    },

    resolveId(id, importer, resolveOpts) {
      if (id === 'lit-html/private-ssr-support.js') {
        const isSsr = Boolean(isServerBuild || resolveOpts?.ssr);
        const conditions = config?.resolve?.conditions ?? [];
        const isDev = Boolean(conditions.includes('development') || (!conditions.includes('production') && config?.mode === 'development'));
        return resolveLitPrivateSsrSupportForVite(config?.root, isSsr, isDev, this as any, importer, resolveOpts as any);
      }

      const cleanId = id.split('?')[0];
      if (cleanId === 'virtual:lit-core/install-globals' || cleanId === 'virtual:lit-core/install-globals.js') {
        return '\0virtual:lit-core/install-globals.js';
      }
      if (cleanId === 'virtual:lit-core/ssr-runtime' || cleanId === 'virtual:lit-core/ssr-runtime.js') {
        return '\0virtual:lit-core/ssr-runtime.js';
      }
      if (cleanId === 'virtual:lit-core/islands-loader' || cleanId === 'virtual:lit-core/islands-loader.js') {
        return '\0virtual:lit-core/islands-loader.js';
      }
      if (cleanId === 'virtual:lit-core/hydrate-support' || cleanId === 'virtual:lit-core/hydrate-support.js') {
        return '\0virtual:lit-core/hydrate-support.js';
      }
      if (
        cleanId === 'virtual:lit-core/resumable-adapter' ||
        cleanId === 'virtual:lit-core/resumable-adapter.js' ||
        cleanId === '@lit-core/resumable/client' ||
        cleanId === '@lit-core/resumable/client.js'
      ) {
        return '\0virtual:lit-core/resumable-adapter.js';
      }
      if (cleanId === '@lit-core/ssr/client') {
        return '\0virtual:lit-core/ssr-runtime.js';
      }
      if (isVirtualLitCoreId(id)) {
        return formatVirtualLitCoreId(id);
      }
      return trackHtmlClientEntry(this as any, config?.root, htmlEntryModules, id, importer, resolveOpts as any);
    },

    load(id) {
      const cleanId = id.split('?')[0];
      if (cleanId === '\0virtual:lit-core/install-globals.js' || cleanId === '\0virtual:lit-core/install-globals') {
        return {
          code: INSTALL_GLOBALS_SOURCE,
          map: null,
        };
      }
      if (cleanId === '\0virtual:lit-core/ssr-runtime.js' || cleanId === '\0virtual:lit-core/ssr-runtime') {
        return {
          code: SSR_RUNTIME_SOURCE,
          map: null,
        };
      }
      if (cleanId === '\0virtual:lit-core/islands-loader.js' || cleanId === '\0virtual:lit-core/islands-loader') {
        return {
          code: getIslandsLoaderSource(),
          map: null,
        };
      }
      if (cleanId === '\0virtual:lit-core/hydrate-support.js' || cleanId === '\0virtual:lit-core/hydrate-support') {
        return {
          code: HYDRATE_SUPPORT_SOURCE,
          map: null,
        };
      }
      if (cleanId === '\0virtual:lit-core/resumable-adapter.js' || cleanId === '\0virtual:lit-core/resumable-adapter') {
        return {
          code: RESUMABLE_ADAPTER_SOURCE,
          map: null,
        };
      }
      return undefined;
    },

    transform(code: string, id: string, transformOptions?: { ssr?: boolean }) {
      const cleanId = id.split('?')[0] ?? id;
      if (!/\.[cm]?[jt]sx?$/.test(cleanId) || cleanId.startsWith('\0virtual:lit-core/') || cleanId.startsWith('\0virtual:css-fuse/') || cleanId.startsWith('\0virtual:html-fuse/')) {
        return null;
      }

      if (options.exclude) {
        const excludes = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
        for (const pattern of excludes) {
          if (matchesPattern(cleanId, pattern)) return null;
        }
      } else if (!options.include && !options.islands && cleanId.includes('/node_modules/')) {
        return null;
      }

      if (options.include) {
        const includes = Array.isArray(options.include) ? options.include : [options.include];
        const matched = includes.some((pattern) => matchesPattern(cleanId, pattern));
        if (!matched) return null;
      }

      const isSsrTransform = Boolean(isServerBuild || transformOptions?.ssr);
      const shouldInjectEntryHydrate = !isSsrTransform && options.hydrate !== false && !cleanId.includes('/node_modules/') && isViteClientEntryModule(this, id, cleanId, htmlEntryModules);

      // Fast check for Lit code
      if (!LIT_SSR_FAST_CHECK.test(code)) {
        if (shouldInjectEntryHydrate) {
          const injected = injectClientEntryImports(code, ['virtual:lit-core/hydrate-support'], {
            filename: cleanId.replace(/^\0/, ''),
            sourcemap: Boolean(options.sourcemap),
          });
          if (injected.transformed) {
            return {
              code: injected.code,
              map: injected.map ? JSON.parse(injected.map) : null,
            };
          }
        }
        return null;
      }

      try {
        const islandsConfig = typeof options.islands === 'object' ? options.islands : null;
        const result = transformSsrComponent(code, {
          filename: cleanId.replace(/^\0/, ''),
          sourcemap: Boolean(options.sourcemap),
          ssrMode: isSsrTransform,
          islands: Boolean(options.islands) && !isSsrTransform,
          islandsInclude: islandsConfig?.include,
          islandsExclude: islandsConfig?.exclude,
        });

        if (result.syntaxError) {
          throw new Error(`Malformed component template syntax: ${result.syntaxError}`);
        }

        if (result.discoveredTags && result.discoveredTags.length > 0) {
          moduleTagsMap.set(cleanId, result.discoveredTags);
        }

        let currentCode = result.modified ? result.code : code;
        let wasModified = result.modified;
        let currentMap: any = result.map ?? null;

        if (shouldInjectEntryHydrate) {
          const injected = injectClientEntryImports(currentCode, ['virtual:lit-core/hydrate-support'], {
            filename: cleanId.replace(/^\0/, ''),
            sourcemap: Boolean(options.sourcemap),
          });
          if (injected.transformed) {
            currentCode = injected.code;
            wasModified = true;
            currentMap = injected.map ? JSON.parse(injected.map) : currentMap;
          }
        }

        if (wasModified) {
          return {
            code: currentCode,
            map: currentMap,
          };
        }

        return null;
      } catch (err) {
        reportTransformError(this, 'lit-ssr', cleanId, err);
      }
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET' || !req.headers.accept?.includes('text/html')) {
          return next();
        }
        const url = req.url || '/';
        if (isStaticAssetRequest(url)) {
          return next();
        }

        try {
          const renderedContent: any = await withScopedIsolateGlobals(async (scopedEnv) => {
            const rootDir = config?.root || process.cwd();
            const indexHtmlPath = path.resolve(rootDir, 'index.html');
            let rawHtml = fs.existsSync(indexHtmlPath) ? fs.readFileSync(indexHtmlPath, 'utf-8') : '<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>';

            rawHtml = await server.transformIndexHtml(url, rawHtml);

            // Load discovered <script type="module" src="..."> entry modules inside scoped isolate globals
            const scriptSrcs = extractModuleScriptSrcs(rawHtml);
            for (const src of scriptSrcs) {
              await server.ssrLoadModule(src);
            }

            if (options.entry) {
              const mod = await server.ssrLoadModule(options.entry);
              const renderFn = mod.render || mod.default;
              if (typeof renderFn === 'function') {
                return await renderFn(url, { req, res });
              }
            }

            return transformHtmlWithSsr(rawHtml, {
              ...options,
              customElements: options.customElements ?? scopedEnv.customElements,
            });
          }, pluginIsolateEnv);

          const isStreaming = options.streaming !== false;
          if (isStreaming && renderedContent && typeof renderedContent.getReader === 'function') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Transfer-Encoding', 'chunked');
            const reader = (renderedContent as ReadableStream<Uint8Array>).getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) res.write(value);
            }
            res.end();
          } else {
            const finalHtml = typeof renderedContent === 'string' ? renderedContent : await collectResult(renderedContent);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(finalHtml);
          }
        } catch (err) {
          if (typeof server.ssrFixStacktrace === 'function' && err instanceof Error) {
            server.ssrFixStacktrace(err);
          }
          if (res.headersSent) {
            if (typeof (res as any).destroy === 'function') {
              (res as any).destroy(err as any);
            } else if (!res.writableEnded && !res.finished) {
              res.end();
            }
          } else {
            next(err);
          }
        }
      });
    },

    transformIndexHtml(html: string, ctx?: any) {
      const islandsManifest: Record<string, string> = {};
      const base = `${(config?.base || '/').replace(/\/$/, '')}/`;
      if (ctx?.bundle) {
        for (const item of Object.values(ctx.bundle)) {
          if ((item as any).type === 'chunk') {
            const chunk = item as any;
            const chunkUrl = `${base}${chunk.fileName.replace(/^\/+/, '')}`;
            if (Array.isArray(chunk.moduleIds)) {
              for (const modId of chunk.moduleIds) {
                const cleanModId = String(modId).split('?')[0];
                const tags = moduleTagsMap.get(cleanModId);
                if (tags) {
                  for (const tag of tags) {
                    islandsManifest[tag] = chunkUrl;
                  }
                }
              }
            }
          }
        }
      }
      return transformHtmlWithSsr(html, { ...options, islandsManifest });
    },

    async generateBundle(_outputOptions, bundle) {
      if (!options.prerender) return;

      const prerenderConfig = typeof options.prerender === 'object' ? options.prerender : {};
      const rawRoutes = prerenderConfig.routes ?? ['/'];
      if (!Array.isArray(rawRoutes) || rawRoutes.length === 0) return;

      const validRoutes: { raw: string; fileName: string }[] = [];
      for (const r of rawRoutes) {
        const sanitized = sanitizePrerenderRoute(r);
        if (sanitized) {
          validRoutes.push({ raw: String(r), fileName: sanitized });
        }
      }
      if (validRoutes.length === 0) return;

      const preExistingCustomElements = (globalThis as any).customElements;

      await withScopedIsolateGlobals(async (scopedEnv) => {
        // Build tag-to-chunk URL manifest across bundle chunks
        const islandsManifest: Record<string, string> = {};
        const base = `${(config?.base || '/').replace(/\/$/, '')}/`;
        for (const item of Object.values(bundle)) {
          if ((item as any).type === 'chunk') {
            const chunk = item as any;
            const chunkUrl = `${base}${chunk.fileName.replace(/^\/+/, '')}`;
            if (Array.isArray(chunk.moduleIds)) {
              for (const modId of chunk.moduleIds) {
                const cleanModId = String(modId).split('?')[0];
                const tags = moduleTagsMap.get(cleanModId);
                if (tags) {
                  for (const tag of tags) {
                    islandsManifest[tag] = chunkUrl;
                  }
                }
              }
            }
            if (typeof chunk.code === 'string' && LIT_SSR_FAST_CHECK.test(chunk.code)) {
              const scanResult = transformSsrComponent(chunk.code, { filename: chunk.fileName });
              for (const tag of scanResult.discoveredTags) {
                if (!islandsManifest[tag]) {
                  islandsManifest[tag] = chunkUrl;
                }
              }
            }
          }
        }

        // Locate client entry JS chunk from bundle
        const entryChunk = Object.values(bundle).find((c: any) => c.type === 'chunk' && Boolean(c.isEntry)) || (Object.values(bundle).find((c: any) => c.type === 'chunk') as any);
        const clientScriptTag = entryChunk ? `<script type="module" src="${base}${entryChunk.fileName.replace(/^\/+/, '')}"></script>` : '';

        // Base template resolution
        const rootDir = config?.root || process.cwd();
        const indexHtmlPath = path.resolve(rootDir, 'index.html');
        let baseTemplate = '';
        if (bundle['index.html'] && (bundle['index.html'] as any).source) {
          baseTemplate = String((bundle['index.html'] as any).source);
        } else if (fs.existsSync(indexHtmlPath)) {
          baseTemplate = fs.readFileSync(indexHtmlPath, 'utf-8');
        }

        // Load discovered <script type="module" src="..."> entry modules when resolvable as JS modules
        if (baseTemplate) {
          const scriptSrcs = extractModuleScriptSrcs(baseTemplate);
          for (const src of scriptSrcs) {
            const cleanSrc = src.replace(/^\/+/, '');
            const resolvedSrc = path.resolve(rootDir, cleanSrc);
            if (fs.existsSync(resolvedSrc) && /\.(?:m?js|cjs)$/i.test(resolvedSrc)) {
              await import(pathToFileURL(resolvedSrc).href);
            }
          }
        }

        if (entryChunk?.facadeModuleId && fs.existsSync(entryChunk.facadeModuleId) && /\.(?:m?js|cjs)$/i.test(entryChunk.facadeModuleId)) {
          await import(pathToFileURL(entryChunk.facadeModuleId).href);
        }

        // Load explicit server entry module when configured (errors propagate directly)
        let serverEntryMod: any = null;
        const entryPath = options.entry || prerenderConfig.entry;
        if (entryPath) {
          const resolvedEntry = path.isAbsolute(entryPath) ? entryPath : path.resolve(rootDir, entryPath);
          serverEntryMod = await import(pathToFileURL(resolvedEntry).href);
        }

        const mergedRegistry = {
          get(tag: string) {
            return scopedEnv.customElements.get(tag) ?? preExistingCustomElements?.get?.(tag);
          },
          define(tag: string, ctor: CustomElementConstructor) {
            scopedEnv.customElements.define(tag, ctor);
          },
        };
        const effectiveCustomElements = options.customElements ?? mergedRegistry;
        const renderOptionsWithManifest = {
          ...options,
          customElements: effectiveCustomElements,
          islandsManifest,
        };

        for (const { raw, fileName } of validRoutes) {
          let routeHtml = '';

          if (serverEntryMod) {
            const renderFn = serverEntryMod.render || serverEntryMod.default || serverEntryMod.template;
            if (typeof renderFn === 'function') {
              const renderResult = await renderFn(raw);
              routeHtml = typeof renderResult === 'string' ? transformHtmlWithSsr(renderResult, renderOptionsWithManifest) : renderToString(renderResult, { customElements: effectiveCustomElements });
            } else if (renderFn && typeof renderFn === 'object') {
              routeHtml = renderToString(renderFn, { customElements: effectiveCustomElements });
            }
          }

          if (!routeHtml) {
            if (baseTemplate) {
              routeHtml = transformHtmlWithSsr(baseTemplate, renderOptionsWithManifest);
            } else {
              let bodyMarkup = '<div id="app"></div>';
              if (typeof entryChunk?.code === 'string') {
                const match = /<([a-z][a-z0-9._-]*-[a-z0-9._-]*)[^>]*>([\s\S]*?)<\/\1>/i.exec(entryChunk.code);
                if (match) {
                  bodyMarkup = transformHtmlWithSsr(match[0], renderOptionsWithManifest);
                }
              }
              routeHtml = `<!DOCTYPE html><html><head>${clientScriptTag}</head><body>${bodyMarkup}</body></html>`;
            }
          }

          if (Object.keys(islandsManifest).length > 0 && !routeHtml.includes('__LIT_ISLANDS_MANIFEST__')) {
            const manifestJson = JSON.stringify(islandsManifest).replace(/</g, '\\u003c');
            const manifestScript = `<script>window.__LIT_ISLANDS_MANIFEST__=${manifestJson};</script>`;
            routeHtml = injectHeadOrBodyScript(routeHtml, manifestScript);
          }

          if (clientScriptTag && !routeHtml.includes(entryChunk.fileName)) {
            routeHtml = injectHeadOrBodyScript(routeHtml, clientScriptTag);
          }

          const existingAsset = bundle[fileName];
          if (existingAsset && existingAsset.type === 'asset') {
            existingAsset.source = routeHtml;
          } else {
            this.emitFile({
              type: 'asset',
              fileName,
              source: routeHtml,
            });
          }
        }
      }, pluginIsolateEnv);
    },
  };
}

export const litSsr = ssr;
