import fs from 'node:fs';
import path from 'node:path';
import { RESUMABLE_ADAPTER_SOURCE } from '@lit-core/resumable';
import { transformResumableComponent } from '@lit-core/resumable/compiler';
import { collectResult, IsolateCustomElementRegistry, installIsolateGlobals, renderToString, transformSsrComponent } from '@lit-core/ssr';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { reportTransformError } from '../errors.js';
import type { SsrOptions } from '../options.js';
import { formatVirtualLitCoreId, isVirtualLitCoreId, matchesPattern } from '../utils.js';
import { ISLANDS_LOADER_SOURCE, SSR_RUNTIME_SOURCE } from '../virtual.js';

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
  const srcs: string[] = [];
  const scriptRegex = /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>/gi;
  let match = scriptRegex.exec(html);
  while (match !== null) {
    const tag = match[0];
    const srcMatch = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(tag);
    const src = srcMatch?.[1] ?? srcMatch?.[2] ?? srcMatch?.[3];
    if (src && !src.startsWith('/@vite/') && !src.startsWith('http://') && !src.startsWith('https://')) {
      srcs.push(src);
    }
    match = scriptRegex.exec(html);
  }
  return srcs;
}

/**
 * Renders custom element tags in an HTML string into genuine Declarative Shadow DOM
 * using @lit-core/ssr.
 */
export function transformHtmlWithSsr(html: string, options: SsrOptions & { islandsManifest?: Record<string, string> } = {}): string {
  if (typeof html !== 'string' || html.length === 0) {
    return html;
  }

  installIsolateGlobals();

  if (typeof (globalThis as any).HTMLElement?.prototype?.attachInternals === 'undefined') {
    (globalThis as any).HTMLElement.prototype.attachInternals = function () {
      return {
        shadowRoot: this.shadowRoot,
        setFormValue() {},
        setValidity() {},
        checkValidity() {
          return true;
        },
        reportValidity() {
          return true;
        },
      };
    };
  }

  const baseRegistry = options.customElements ?? (globalThis as any).customElements;
  const registry = new IsolateCustomElementRegistry(baseRegistry);
  const domPaths = Boolean(options.domPaths);
  const resumable = Boolean(options.resumable);
  const islands = Boolean(options.islands);

  // 1. Stash protected blocks (comments, scripts, styles)
  const protectedBlocks: string[] = [];
  let tokenizedHtml = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, (match) => {
    const token = `<!--__LIT_PROTECTED_BLOCK_${protectedBlocks.length}__-->`;
    protectedBlocks.push(match);
    return token;
  });

  // If domPaths is requested, ensure data-lit-paths is added to custom elements
  if (domPaths) {
    tokenizedHtml = tokenizedHtml.replace(/<([a-z][a-z0-9._-]*-[a-z0-9._-]*)([^>]*)>/gi, (match, tag, attrs) => {
      if (!attrs.includes('data-lit-paths')) {
        return `<${tag}${attrs} data-lit-paths="true">`;
      }
      return match;
    });
  }

  // 2. Render HTML using @lit-core/ssr (only expanding registered custom elements in registry)
  const templateResult = { strings: [tokenizedHtml], values: [] };
  let renderedHtml = renderToString(templateResult, {
    customElements: registry,
    domPaths,
    resumable,
    mode: 'dsd',
  });

  // 3. Restore protected blocks
  for (let i = 0; i < protectedBlocks.length; i++) {
    renderedHtml = renderedHtml.replace(`<!--__LIT_PROTECTED_BLOCK_${i}__-->`, protectedBlocks[i]);
  }

  // 4. Inject islands manifest if present
  if (options.islandsManifest && Object.keys(options.islandsManifest).length > 0 && !renderedHtml.includes('__LIT_ISLANDS_MANIFEST__')) {
    const manifestJson = JSON.stringify(options.islandsManifest).replace(/</g, '\\u003c');
    const manifestScript = `<script>window.__LIT_ISLANDS_MANIFEST__=${manifestJson};</script>`;
    if (renderedHtml.includes('</head>')) {
      renderedHtml = renderedHtml.replace('</head>', `  ${manifestScript}\n</head>`);
    } else if (renderedHtml.includes('</body>')) {
      renderedHtml = renderedHtml.replace('</body>', `  ${manifestScript}\n</body>`);
    } else {
      renderedHtml = `${manifestScript}${renderedHtml}`;
    }
  }

  // 5. Inject islands loader microloader if islands option is enabled
  if (islands && !renderedHtml.includes('islands-loader')) {
    const islandScript = `<script type="module" src="/@id/__x00__virtual:lit-core/islands-loader.js"></script>`;
    if (renderedHtml.includes('</head>')) {
      renderedHtml = renderedHtml.replace('</head>', `  ${islandScript}\n</head>`);
    } else if (renderedHtml.includes('</body>')) {
      renderedHtml = renderedHtml.replace('</body>', `  ${islandScript}\n</body>`);
    } else {
      renderedHtml += islandScript;
    }
  }

  // 6. Inject state snapshot if resumable mode is enabled and not already present
  if (resumable && !renderedHtml.includes('<script type="lit/state">') && options.injectState !== false) {
    const stateScript = '<script type="lit/state">{}</script>';
    if (renderedHtml.includes('</body>')) {
      renderedHtml = renderedHtml.replace('</body>', `  ${stateScript}\n</body>`);
    } else {
      renderedHtml += stateScript;
    }
  }

  return renderedHtml;
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

  return {
    name: 'lit-ssr',
    enforce: 'post',

    configResolved(resolvedConfig) {
      config = resolvedConfig;
      isServerBuild = Boolean(config.build?.ssr);
    },

    resolveId(id) {
      const cleanId = id.split('?')[0];
      if (cleanId === 'virtual:lit-core/ssr-runtime' || cleanId === 'virtual:lit-core/ssr-runtime.js') {
        return '\0virtual:lit-core/ssr-runtime.js';
      }
      if (cleanId === 'virtual:lit-core/islands-loader' || cleanId === 'virtual:lit-core/islands-loader.js') {
        return '\0virtual:lit-core/islands-loader.js';
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
      return undefined;
    },

    load(id) {
      const cleanId = id.split('?')[0];
      if (cleanId === '\0virtual:lit-core/ssr-runtime.js' || cleanId === '\0virtual:lit-core/ssr-runtime') {
        return {
          code: SSR_RUNTIME_SOURCE,
          map: null,
        };
      }
      if (cleanId === '\0virtual:lit-core/islands-loader.js' || cleanId === '\0virtual:lit-core/islands-loader') {
        return {
          code: ISLANDS_LOADER_SOURCE,
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
      if (!/\.[jt]sx?$/.test(cleanId)) {
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

      // Fast check for Lit code
      if (!LIT_SSR_FAST_CHECK.test(code)) {
        return null;
      }

      try {
        const isSsrTransform = Boolean(isServerBuild || transformOptions?.ssr);
        const islandsConfig = typeof options.islands === 'object' ? options.islands : null;
        const result = transformSsrComponent(code, {
          filename: cleanId,
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
        let currentMap = result.map ?? null;

        if (options.resumable && !isSsrTransform && !currentCode.includes('withResumable')) {
          const resumableRes = transformResumableComponent(currentCode, {
            filename: cleanId,
            virtualModule: 'virtual:lit-core/resumable-adapter',
          });
          if (resumableRes.transformed) {
            currentCode = resumableRes.code;
            wasModified = true;
            currentMap = resumableRes.map ?? currentMap;
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
          installIsolateGlobals();
          const rootDir = config?.root || process.cwd();
          const indexHtmlPath = path.resolve(rootDir, 'index.html');
          let rawHtml = fs.existsSync(indexHtmlPath) ? fs.readFileSync(indexHtmlPath, 'utf-8') : '<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>';

          rawHtml = await server.transformIndexHtml(url, rawHtml);

          // Automatically load discovered <script type="module" src="..."> entry modules
          // so component definitions register into customElements before SSR runs
          const scriptSrcs = extractModuleScriptSrcs(rawHtml);
          for (const src of scriptSrcs) {
            try {
              await server.ssrLoadModule(src);
            } catch {}
          }

          let renderedContent: any = rawHtml;
          if (options.entry) {
            try {
              const mod = await server.ssrLoadModule(options.entry);
              const renderFn = mod.render || mod.default;
              if (typeof renderFn === 'function') {
                renderedContent = await renderFn(url, { req, res });
              }
            } catch {}
          } else {
            renderedContent = transformHtmlWithSsr(rawHtml, options);
          }

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
            try {
              if (typeof (res as any).destroy === 'function') {
                (res as any).destroy(err as any);
              } else if (!res.writableEnded && !res.finished) {
                res.end();
              }
            } catch {}
          } else {
            next(err);
          }
        }
      });
    },

    transformIndexHtml(html: string, ctx?: any) {
      const islandsManifest: Record<string, string> = {};
      const base = (config?.base || '/').replace(/\/$/, '') + '/';
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

      installIsolateGlobals();

      // Build tag-to-chunk URL manifest across bundle chunks
      const islandsManifest: Record<string, string> = {};
      const base = (config?.base || '/').replace(/\/$/, '') + '/';
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
            try {
              const scanResult = transformSsrComponent(chunk.code, { filename: chunk.fileName });
              for (const tag of scanResult.discoveredTags) {
                if (!islandsManifest[tag]) {
                  islandsManifest[tag] = chunkUrl;
                }
              }
            } catch {}
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

      // Automatically load discovered <script type="module" src="..."> entry modules
      if (baseTemplate) {
        const scriptSrcs = extractModuleScriptSrcs(baseTemplate);
        for (const src of scriptSrcs) {
          try {
            const cleanSrc = src.replace(/^\/+/, '');
            const resolvedSrc = path.resolve(rootDir, cleanSrc);
            if (fs.existsSync(resolvedSrc)) {
              await import(resolvedSrc);
            }
          } catch {}
        }
      }

      if (entryChunk?.facadeModuleId && fs.existsSync(entryChunk.facadeModuleId)) {
        try {
          await import(entryChunk.facadeModuleId);
        } catch {}
      }

      // Check if entry module or server render function exists
      let serverEntryMod: any = null;
      const entryPath = options.entry || prerenderConfig.entry;
      if (entryPath) {
        try {
          const resolvedEntry = path.isAbsolute(entryPath) ? entryPath : path.resolve(rootDir, entryPath);
          serverEntryMod = await import(resolvedEntry);
        } catch {}
      }

      const renderOptionsWithManifest = {
        ...options,
        islandsManifest,
      };

      for (const { raw, fileName } of validRoutes) {
        let routeHtml = '';

        if (serverEntryMod) {
          const renderFn = serverEntryMod.render || serverEntryMod.default || serverEntryMod.template;
          if (typeof renderFn === 'function') {
            const renderResult = await renderFn(raw);
            routeHtml = typeof renderResult === 'string' ? transformHtmlWithSsr(renderResult, renderOptionsWithManifest) : renderToString(renderResult, { customElements: options.customElements });
          } else if (renderFn && typeof renderFn === 'object') {
            routeHtml = renderToString(renderFn, { customElements: options.customElements });
          }
        }

        if (!routeHtml) {
          if (baseTemplate) {
            routeHtml = transformHtmlWithSsr(baseTemplate, renderOptionsWithManifest);
          } else {
            let bodyMarkup = '<div id="app"></div>';
            if (entryChunk?.code) {
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
          if (routeHtml.includes('</head>')) {
            routeHtml = routeHtml.replace('</head>', `  ${manifestScript}\n</head>`);
          } else if (routeHtml.includes('<body>')) {
            routeHtml = routeHtml.replace('<body>', `<head>${manifestScript}</head><body>`);
          } else {
            routeHtml = `${manifestScript}${routeHtml}`;
          }
        }

        if (clientScriptTag && !routeHtml.includes(entryChunk.fileName)) {
          if (routeHtml.includes('</head>')) {
            routeHtml = routeHtml.replace('</head>', `  ${clientScriptTag}\n</head>`);
          } else if (routeHtml.includes('<body>')) {
            routeHtml = routeHtml.replace('<body>', `<head>${clientScriptTag}</head><body>`);
          } else {
            routeHtml = `${clientScriptTag}${routeHtml}`;
          }
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
    },
  };
}

export const litSsr = ssr;
