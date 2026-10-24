import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, compileResumableLoader, extractCustomElementTags } from '@lit-core/resumable';
import { IsolateCustomElementRegistry, installIsolateGlobals, renderToString } from '@lit-core/ssr';
import type { Compiler } from 'webpack';
import { registerPluginState, unregisterPluginState } from './loader.js';
import type {
  CssFuseOptions,
  CssMinifierOptions,
  DirectivesOptions,
  DirtyMaskOptions,
  DomPathsOptions,
  ElemProxyOptions,
  EventHoistOptions,
  HtmlAotOptions,
  HtmlFuseOptions,
  HtmlMinifierOptions,
  LitPluginOptions,
  MemoizeOptions,
  PropsLowerOptions,
  ResumableOptions,
  SsrOptions,
  TagShakeOptions,
} from './options.js';
import { runFuseOptimization, runHtmlFuseOptimization, runScopingAudit } from './transforms.js';
import {
  BARE_FUSED_ID_REGEX,
  BARE_HTML_FUSED_ID_REGEX,
  extractHtmlTemplateId,
  extractLitCoreVirtualSubpath,
  extractSheetId,
  isVirtualHtmlFusedId,
  isVirtualLitCoreId,
  VIRTUAL_FUSED_PREFIX,
  VIRTUAL_HTML_FUSED_PREFIX,
  VIRTUAL_LIT_CORE_PREFIX,
} from './utils.js';
import { getVirtualLitCoreModule } from './virtual.js';

let loaderPath = fileURLToPath(new URL('./loader.js', import.meta.url));
if (!fs.existsSync(loaderPath)) {
  const tsPath = fileURLToPath(new URL('./loader.ts', import.meta.url));
  if (fs.existsSync(tsPath)) {
    loaderPath = tsPath;
  }
}

let nextPluginId = 0;

/**
 * Determines whether the Webpack compilation target is a server or isolate runtime.
 */
export function isSsrTarget(target: unknown): boolean {
  if (!target) return false;
  if (Array.isArray(target)) {
    return target.some((t) => isSsrTarget(t));
  }
  if (typeof target === 'string') {
    const t = target.toLowerCase();
    return t === 'node' || t.startsWith('node') || t === 'async-node' || t === 'webworker' || t.includes('worker') || t === 'electron-main' || t === 'electron-preload';
  }
  return false;
}

export class LitWebpackPlugin {
  readonly id: string;
  readonly options: LitPluginOptions;
  readonly name: string;
  private virtualSheets = new Map<string, string>();
  private virtualTemplates = new Map<string, string>();
  private transformedFiles = new Map<string, string>();

  constructor(options: LitPluginOptions = {}, name = 'LitWebpackPlugin') {
    this.id = `lit-plugin-${++nextPluginId}`;
    this.options = {
      cssFuse: true,
      ...options,
    };
    this.name = name;
  }

  [Symbol.iterator](): Iterator<LitWebpackPlugin> {
    let yielded = false;
    const self = this;
    return {
      next(): IteratorResult<LitWebpackPlugin> {
        if (!yielded) {
          yielded = true;
          return { value: self, done: false };
        }
        return { value: undefined, done: true };
      },
    };
  }

  apply(compiler: Compiler): void {
    const logger = compiler.getInfrastructureLogger(this.name);
    const options = this.options;
    const cssFuseOpt = options.cssFuse !== false ? (typeof options.cssFuse === 'object' ? options.cssFuse : {}) : null;
    const rawHtmlFuse = options.htmlFuse ?? options['html-fuse'];
    const htmlFuseOpt = rawHtmlFuse ? (typeof rawHtmlFuse === 'object' ? rawHtmlFuse : {}) : null;

    // Detect whether current Webpack compiler target requires SSR
    const isTargetServer = isSsrTarget(compiler.options.target);
    const rawSsr = options.ssr ?? options['lit-ssr'];
    const isSsrActive = rawSsr !== false && (rawSsr != null || isTargetServer);
    const ssrOpt: SsrOptions | null = isSsrActive ? (typeof rawSsr === 'object' ? rawSsr : {}) : null;

    if (isSsrActive && rawSsr == null) {
      logger.info(`⚡ [ssr] Auto-detected server target (${String(compiler.options.target)}); activated @lit-core/ssr compilation.`);
    }

    // Register active state with the loader registry
    registerPluginState(this.id, {
      transformedFiles: this.transformedFiles,
      virtualSheets: this.virtualSheets,
      virtualTemplates: this.virtualTemplates,
      isSsr: isTargetServer,
      options: {
        ...this.options,
        ssr: ssrOpt || false,
      },
    });

    // Auto-inject loader into compiler module rules
    compiler.options.module = compiler.options.module || { rules: [] };
    compiler.options.module.rules = compiler.options.module.rules || [];

    const includePattern = /\.[jt]sx?$/;
    compiler.options.module.rules.unshift({
      test: includePattern,
      exclude: [/node_modules/, /\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/],
      use: [
        {
          loader: loaderPath,
          options: {
            pluginId: this.id,
          },
        },
      ],
    });

    if (cssFuseOpt || htmlFuseOpt) {
      // Tap beforeCompile to perform AOT extraction or dev scoping audit
      compiler.hooks.beforeCompile.tapAsync(this.name, (_params, callback) => {
        const isDev = compiler.options.mode === 'development';

        if (cssFuseOpt) {
          const { scopingAudit = true, applyInDev = false } = cssFuseOpt;
          if (isDev && !applyInDev) {
            if (scopingAudit) {
              try {
                const diags = runScopingAudit(cssFuseOpt);
                for (const d of diags) {
                  const filePath = d.filePath || 'unknown';
                  logger.warn(`[css-fuse] ${d.code}: ${d.message} (${filePath}:${d.line || 1})`);
                }
              } catch (err) {
                logger.warn(`[css-fuse] Dev scoping audit failed: ${err}`);
              }
            }
          } else {
            try {
              const { fuseResult, virtualSheets, transformedFiles } = runFuseOptimization(cssFuseOpt);

              this.virtualSheets.clear();
              for (const [key, val] of virtualSheets.entries()) {
                this.virtualSheets.set(key, val);
              }

              for (const [key, val] of transformedFiles.entries()) {
                this.transformedFiles.set(key, val);
              }

              const stats = fuseResult.stats;
              logger.info(
                `⚡ [css-fuse] Deduplicated ${stats.rulesDeduped} rules into ${stats.fusedSheetsCreated} shared constructable sheets across ${stats.componentsRewritten} components (~${(stats.bytesSaved / 1024).toFixed(1)} KB saved)`,
              );

              if (scopingAudit && fuseResult.diagnostics?.length) {
                for (const d of fuseResult.diagnostics) {
                  const filePath = d.filePath || 'unknown';
                  logger.warn(`[css-fuse] ${d.code}: ${d.message} (${filePath}:${d.line || 1})`);
                }
              }
            } catch (err: any) {
              const origMessage = err instanceof Error ? err.message : String(err);
              const error = new Error(`[css-fuse] Optimization pass failed: ${origMessage}`);
              if (err instanceof Error && err.stack) {
                error.stack = err.stack;
              }
              logger.error(error.message);
              callback(error);
              return;
            }
          }
        }

        if (htmlFuseOpt) {
          try {
            const { fuseResult, virtualTemplates, transformedFiles } = runHtmlFuseOptimization(htmlFuseOpt);

            this.virtualTemplates.clear();
            for (const [key, val] of virtualTemplates.entries()) {
              this.virtualTemplates.set(key, val);
            }

            for (const [key, val] of transformedFiles.entries()) {
              this.transformedFiles.set(key, val);
            }

            const stats = fuseResult.stats;
            logger.info(
              `⚡ [html-fuse] Deduplicated ${stats.fragmentsDeduped} fragments into ${stats.fusedTemplatesCreated} shared templates across ${stats.componentsRewritten} components (~${(stats.bytesSaved / 1024).toFixed(1)} KB saved)`,
            );
          } catch (err: any) {
            const origMessage = err instanceof Error ? err.message : String(err);
            const error = new Error(`[html-fuse] Optimization pass failed: ${origMessage}`);
            if (err instanceof Error && err.stack) {
              error.stack = err.stack;
            }
            logger.error(error.message);
            callback(error);
            return;
          }
        }

        callback();
      });
    }

    // Hook Webpack 5 virtual resource scheme loader
    compiler.hooks.compilation.tap(this.name, (compilation) => {
      const NormalModule = compiler.webpack?.NormalModule;
      if (NormalModule?.getCompilationHooks) {
        const hooks = NormalModule.getCompilationHooks(compilation);
        hooks.readResourceForScheme.for('virtual').tapPromise(this.name, async (resource: string) => {
          if (isVirtualLitCoreId(resource) || resource.includes('lit-core')) {
            const subpath = extractLitCoreVirtualSubpath(resource);
            const code = getVirtualLitCoreModule(subpath);
            if (code !== undefined) {
              return Buffer.from(code);
            }
          }

          if (isVirtualHtmlFusedId(resource) || resource.includes('html-fuse')) {
            const templateId = extractHtmlTemplateId(resource).split('?')[0];
            const code =
              this.virtualTemplates.get(templateId) ||
              this.virtualTemplates.get(path.basename(templateId)) ||
              this.virtualTemplates.get(templateId.replace(/\.js$/, '')) ||
              this.virtualTemplates.get(`${templateId}.js`);

            if (code !== undefined) {
              return Buffer.from(code);
            }

            throw new Error(`[html-fuse] Virtual shared template not found: ${resource}`);
          }

          const sheetId = extractSheetId(resource).split('?')[0];
          const code =
            this.virtualSheets.get(sheetId) || this.virtualSheets.get(path.basename(sheetId)) || this.virtualSheets.get(sheetId.replace(/\.js$/, '')) || this.virtualSheets.get(`${sheetId}.js`);

          if (code !== undefined) {
            return Buffer.from(code);
          }

          throw new Error(`[virtual] Virtual resource not found: ${resource}`);
        });
      }
    });

    // Redirect legacy, bare, or unprefixed imports to virtual:...
    compiler.hooks.normalModuleFactory.tap(this.name, (nmf) => {
      nmf.hooks.resolve.tap(this.name, (resolveData) => {
        if (!resolveData.request) return;
        const [reqBase, reqQuery] = resolveData.request.split('?');
        const querySuffix = reqQuery ? `?${reqQuery}` : '';
        if (reqBase.startsWith('@lit-core/resumable/client')) {
          resolveData.request = `${VIRTUAL_LIT_CORE_PREFIX}resumable-adapter.js${querySuffix}`;
        } else if (reqBase.startsWith('@lit-core/native/runtime')) {
          resolveData.request = `${VIRTUAL_LIT_CORE_PREFIX}native-runtime.js${querySuffix}`;
        } else if (reqBase.startsWith('@lit-core/dom-paths/client')) {
          resolveData.request = `${VIRTUAL_LIT_CORE_PREFIX}dom-paths.js${querySuffix}`;
        } else if (reqBase.startsWith('@lit-core/ssr/client') || reqBase === 'virtual:lit-core/ssr-runtime') {
          resolveData.request = `${VIRTUAL_LIT_CORE_PREFIX}ssr-runtime.js${querySuffix}`;
        } else if (BARE_HTML_FUSED_ID_REGEX.test(reqBase)) {
          const filename = reqBase.endsWith('.js') ? reqBase : `${reqBase}.js`;
          resolveData.request = `${VIRTUAL_HTML_FUSED_PREFIX}${filename}${querySuffix}`;
        } else if (reqBase.startsWith('virtual:lit-html-fuse/')) {
          resolveData.request = resolveData.request.replace('virtual:lit-html-fuse/', VIRTUAL_HTML_FUSED_PREFIX);
        } else if (BARE_FUSED_ID_REGEX.test(reqBase)) {
          const filename = reqBase.endsWith('.js') ? reqBase : `${reqBase}.js`;
          resolveData.request = `${VIRTUAL_FUSED_PREFIX}${filename}${querySuffix}`;
        } else if (reqBase.startsWith('virtual:lit-css-fuse/')) {
          resolveData.request = resolveData.request.replace('virtual:lit-css-fuse/', VIRTUAL_FUSED_PREFIX);
        }
      });
    });

    const resumableOpt = options.resumable ? (typeof options.resumable === 'object' ? options.resumable : {}) : null;
    if (resumableOpt) {
      compiler.hooks.thisCompilation.tap(this.name, (compilation) => {
        const stage = compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS;
        compilation.hooks.processAssets.tapPromise({ name: this.name, stage }, async (assets) => {
          const chunkMap = new Map<string, string[]>();
          const rawPublicPath = compilation.outputOptions.publicPath;
          const publicPath = typeof rawPublicPath === 'string' && rawPublicPath !== 'auto' ? rawPublicPath : '/';

          for (const chunk of compilation.chunks) {
            const tags = new Set<string>();
            for (const file of chunk.files) {
              if (file.endsWith('.js') && !file.includes('resumable-loader')) {
                const asset = compilation.getAsset(file);
                if (asset) {
                  const content = asset.source.source().toString();
                  const foundTags = extractCustomElementTags(content);
                  for (const t of foundTags) {
                    tags.add(t);
                  }
                }
              }
            }
            if (tags.size > 0) {
              const primaryFile = Array.from(chunk.files).find((f) => f.endsWith('.js')) || chunk.name;
              if (primaryFile) {
                chunkMap.set(primaryFile, Array.from(tags));
              }
            }
          }

          const manifest = buildManifest(chunkMap, {
            chunkResolver: resumableOpt.chunkResolver,
            basePath: publicPath,
          });

          const loaderCode = compileResumableLoader({
            manifest,
            preloadOnHover: resumableOpt.preloadOnHover !== false,
          });

          const RawSource = compiler.webpack.sources.RawSource;
          compilation.emitAsset('resumable-loader.js', new RawSource(loaderCode));

          for (const [filename, asset] of Object.entries(assets)) {
            if (filename.endsWith('.html')) {
              const html = asset.source().toString();
              const scriptTag = `<script>${loaderCode}</script>`;
              let modifiedHtml: string;
              if (html.includes('</head>')) {
                modifiedHtml = html.replace('</head>', `${scriptTag}\n</head>`);
              } else if (html.includes('<body')) {
                modifiedHtml = html.replace('<body', `${scriptTag}\n<body`);
              } else {
                modifiedHtml = `${scriptTag}\n${html}`;
              }
              compilation.updateAsset(filename, new RawSource(modifiedHtml));
            }
          }
        });
      });
    }

    const compilationHook = compiler.hooks.thisCompilation || compiler.hooks.compilation;
    if (ssrOpt && ssrOpt.manifest !== false && compilationHook) {
      compilationHook.tap(this.name, (compilation) => {
        if (!compiler.webpack?.Compilation || !compilation.hooks?.processAssets) return;
        const stage = compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS;
        compilation.hooks.processAssets.tapPromise({ name: this.name, stage }, async (assets) => {
          const manifestOpt = typeof ssrOpt.manifest === 'object' ? ssrOpt.manifest : {};
          const manifestFileName = manifestOpt.fileName || 'ssr-manifest.json';

          // 1. Resolve effective basePath
          let publicPath: string;
          if (typeof manifestOpt.basePath === 'string') {
            publicPath = manifestOpt.basePath === '' ? '' : manifestOpt.basePath.endsWith('/') ? manifestOpt.basePath : `${manifestOpt.basePath}/`;
          } else {
            const rawPublicPath = compilation.outputOptions.publicPath;
            publicPath = typeof rawPublicPath === 'string' && rawPublicPath !== 'auto' ? (rawPublicPath.endsWith('/') ? rawPublicPath : `${rawPublicPath}/`) : '/';
          }

          // 2. Check for pre-existing manifest (incremental/watch/multi-compiler passes)
          let existingManifest: any = null;
          const existingAsset = typeof compilation.getAsset === 'function' ? compilation.getAsset(manifestFileName) : null;
          if (existingAsset) {
            try {
              const rawSource = typeof existingAsset.source?.source === 'function' ? existingAsset.source.source() : existingAsset.source;
              const content = Buffer.isBuffer(rawSource) ? rawSource.toString('utf-8') : String(rawSource);
              existingManifest = JSON.parse(content);
            } catch {
              existingManifest = null;
            }
          }

          // 3. Initialize manifest, preserving existing timestamp for deterministic byte identity
          const manifest: {
            tags: Record<string, { file: string; css: string[]; imports: string[]; isIsland: boolean }>;
            modules: Record<string, { file: string; css: string[]; tags: string[]; isIsland: boolean }>;
            sharedStyles: string[];
            metadata: { generator: string; version: string; target: string; timestamp: string; basePath?: string };
          } = {
            tags: {},
            modules: {},
            sharedStyles: [],
            metadata: {
              generator: '@lit-core/webpack-plugin',
              version: '1.0.0',
              target: String(compiler.options.target || 'node'),
              timestamp: existingManifest?.metadata?.timestamp || new Date().toISOString(),
              basePath: publicPath,
            },
          };

          // 4. Merge existing tags, modules, and styles from prior compiler pass
          if (existingManifest) {
            if (existingManifest.tags && typeof existingManifest.tags === 'object') {
              manifest.tags = { ...existingManifest.tags };
            }
            if (existingManifest.modules && typeof existingManifest.modules === 'object') {
              manifest.modules = { ...existingManifest.modules };
            }
            if (Array.isArray(existingManifest.sharedStyles)) {
              manifest.sharedStyles = [...existingManifest.sharedStyles];
            }
          }

          // 5. Accumulate sharedStyles
          for (const [sheetKey] of this.virtualSheets.entries()) {
            const sheetUrl = `${publicPath}_fused_${sheetKey}.js`;
            if (!manifest.sharedStyles.includes(sheetUrl)) {
              manifest.sharedStyles.push(sheetUrl);
            }
          }

          for (const [assetName] of Object.entries(assets)) {
            if (assetName.endsWith('.css')) {
              const cssUrl = `${publicPath}${assetName}`;
              if (!manifest.sharedStyles.includes(cssUrl)) {
                manifest.sharedStyles.push(cssUrl);
              }
            }
          }

          const islandsConfig = typeof ssrOpt.islands === 'object' ? ssrOpt.islands : null;
          const islandPatterns = islandsConfig?.include || [];

          // 6. Inspect chunks and populate tags/modules
          for (const chunk of compilation.chunks) {
            const jsFiles = Array.from(chunk.files).filter((f) => f.endsWith('.js') && !f.includes('resumable-loader'));
            const cssFiles = Array.from(chunk.files)
              .filter((f) => f.endsWith('.css'))
              .map((f) => `${publicPath}${f}`);
            const primaryJsFile = jsFiles[0] || (chunk.name ? `${chunk.name}.js` : null);
            if (!primaryJsFile) continue;

            const chunkTags = new Set<string>();
            for (const file of jsFiles) {
              const asset = typeof compilation.getAsset === 'function' ? compilation.getAsset(file) : null;
              if (asset) {
                const rawSource = typeof asset.source?.source === 'function' ? asset.source.source() : asset.source;
                const content = Buffer.isBuffer(rawSource) ? rawSource.toString('utf-8') : String(rawSource);
                const tags = extractCustomElementTags(content);
                for (const t of tags) chunkTags.add(t);
              }
            }

            const tagsArray = Array.from(chunkTags);
            const chunkUrl = `${publicPath}${primaryJsFile}`;

            for (const tag of tagsArray) {
              const isIsland = ssrOpt.islands === true || islandPatterns.some((p) => tag === p || tag.includes(p));
              manifest.tags[tag] = {
                file: chunkUrl,
                css: cssFiles,
                imports: [],
                isIsland,
              };
            }

            if (chunk.name) {
              const isIsland = ssrOpt.islands === true || tagsArray.some((tag) => islandPatterns.some((p) => tag === p || tag.includes(p)));
              manifest.modules[chunk.name] = {
                file: chunkUrl,
                css: cssFiles,
                tags: tagsArray,
                isIsland,
              };
            }
          }

          // 7. Emit or update asset
          const RawSource = compiler.webpack.sources.RawSource;
          const manifestSource = JSON.stringify(manifest, null, 2);

          if (existingAsset) {
            if (typeof compilation.updateAsset === 'function') {
              compilation.updateAsset(manifestFileName, new RawSource(manifestSource));
            } else if (typeof compilation.emitAsset === 'function') {
              compilation.emitAsset(manifestFileName, new RawSource(manifestSource));
            }
          } else {
            compilation.emitAsset(manifestFileName, new RawSource(manifestSource));
          }

          // 8. Prerender HTML assets in compilation when present
          if (ssrOpt.prerender !== false) {
            installIsolateGlobals();
            const baseRegistry = ssrOpt.customElements ?? (globalThis as any).customElements;
            const registry = new IsolateCustomElementRegistry(baseRegistry);
            const islandsManifestMap: Record<string, string> = {};
            for (const [tag, info] of Object.entries(manifest.tags)) {
              islandsManifestMap[tag] = info.file;
            }
            for (const [assetName, asset] of Object.entries(assets)) {
              if (assetName.endsWith('.html')) {
                const rawSource = typeof asset.source === 'function' ? asset.source() : asset;
                const htmlStr = Buffer.isBuffer(rawSource) ? rawSource.toString('utf-8') : String(rawSource);
                let renderedHtml = renderToString(
                  { strings: [htmlStr] as unknown as TemplateStringsArray, values: [] },
                  {
                    customElements: registry,
                    domPaths: Boolean(ssrOpt.domPaths),
                    resumable: Boolean(ssrOpt.resumable),
                    mode: 'dsd',
                  },
                );
                if (Object.keys(islandsManifestMap).length > 0 && !renderedHtml.includes('__LIT_ISLANDS_MANIFEST__')) {
                  const manifestScript = `<script>window.__LIT_ISLANDS_MANIFEST__=${JSON.stringify(islandsManifestMap).replace(/</g, '\\u003c')};</script>`;
                  renderedHtml = renderedHtml.includes('</head>') ? renderedHtml.replace('</head>', `  ${manifestScript}\n</head>`) : `${manifestScript}${renderedHtml}`;
                }
                if (typeof compilation.updateAsset === 'function') {
                  compilation.updateAsset(assetName, new RawSource(renderedHtml));
                }
              }
            }
          }

          logger.info(`⚡ [ssr] Emitted SSR manifest (${manifestFileName}) with ${Object.keys(manifest.tags).length} custom element tags across ${compilation.chunks.size} chunks`);
        });
      });
    }

    // Clean up registry on compiler shutdown
    compiler.hooks.shutdown.tap(this.name, () => {
      unregisterPluginState(this.id);
    });
  }
}

export class CssFuseWebpackPlugin extends LitWebpackPlugin {
  constructor(options: CssFuseOptions = {}) {
    super({ cssFuse: options, htmlFuse: false, propsLower: false, cssMinifier: false, htmlMinifier: false }, 'CssFuseWebpackPlugin');
  }
}

export class HtmlFuseWebpackPlugin extends LitWebpackPlugin {
  constructor(options: HtmlFuseOptions = {}) {
    super({ cssFuse: false, htmlFuse: options, propsLower: false, cssMinifier: false, htmlMinifier: false }, 'HtmlFuseWebpackPlugin');
  }
}

export class PropsLowerWebpackPlugin extends LitWebpackPlugin {
  constructor(options: PropsLowerOptions = {}) {
    super({ cssFuse: false, htmlFuse: false, propsLower: options, cssMinifier: false, htmlMinifier: false }, 'PropsLowerWebpackPlugin');
  }
}

export class CssMinifierWebpackPlugin extends LitWebpackPlugin {
  constructor(options: CssMinifierOptions = {}) {
    super({ cssFuse: false, htmlFuse: false, propsLower: false, cssMinifier: options, htmlMinifier: false }, 'CssMinifierWebpackPlugin');
  }
}

export class HtmlMinifierWebpackPlugin extends LitWebpackPlugin {
  constructor(options: HtmlMinifierOptions = {}) {
    super({ cssFuse: false, htmlFuse: false, propsLower: false, cssMinifier: false, htmlMinifier: options }, 'HtmlMinifierWebpackPlugin');
  }
}

export class ElemProxyWebpackPlugin extends LitWebpackPlugin {
  constructor(options: ElemProxyOptions = {}) {
    super({ cssFuse: false, htmlFuse: false, propsLower: false, elemProxy: options, cssMinifier: false, htmlMinifier: false }, 'ElemProxyWebpackPlugin');
  }
}

export class EventHoistWebpackPlugin extends LitWebpackPlugin {
  constructor(options: EventHoistOptions = {}) {
    super(
      { cssFuse: false, htmlFuse: false, propsLower: false, elemProxy: false, eventHoist: options, dirtyMask: false, htmlAot: false, cssMinifier: false, htmlMinifier: false },
      'EventHoistWebpackPlugin',
    );
  }
}

export class DirtyMaskWebpackPlugin extends LitWebpackPlugin {
  constructor(options: DirtyMaskOptions = {}) {
    super(
      { cssFuse: false, htmlFuse: false, propsLower: false, elemProxy: false, eventHoist: false, dirtyMask: options, htmlAot: false, cssMinifier: false, htmlMinifier: false },
      'DirtyMaskWebpackPlugin',
    );
  }
}

export class HtmlAotWebpackPlugin extends LitWebpackPlugin {
  constructor(options: HtmlAotOptions = {}) {
    super({ cssFuse: false, htmlFuse: false, propsLower: false, dirtyMask: false, htmlAot: options, cssMinifier: false, htmlMinifier: false }, 'HtmlAotWebpackPlugin');
  }
}

export function lit(options: LitPluginOptions = {}): LitWebpackPlugin {
  return new LitWebpackPlugin(options);
}

export function cssFuse(options: CssFuseOptions = {}): CssFuseWebpackPlugin {
  return new CssFuseWebpackPlugin(options);
}

export function htmlFuse(options: HtmlFuseOptions = {}): HtmlFuseWebpackPlugin {
  return new HtmlFuseWebpackPlugin(options);
}

export function propsLower(options: PropsLowerOptions = {}): PropsLowerWebpackPlugin {
  return new PropsLowerWebpackPlugin(options);
}

export function elemProxy(options: ElemProxyOptions = {}): ElemProxyWebpackPlugin {
  return new ElemProxyWebpackPlugin(options);
}

export function eventHoist(options: EventHoistOptions = {}): EventHoistWebpackPlugin {
  return new EventHoistWebpackPlugin(options);
}

export function dirtyMask(options: DirtyMaskOptions = {}): DirtyMaskWebpackPlugin {
  return new DirtyMaskWebpackPlugin(options);
}

export class DomPathsWebpackPlugin extends LitWebpackPlugin {
  constructor(options: DomPathsOptions = {}) {
    super(
      { cssFuse: false, htmlFuse: false, propsLower: false, elemProxy: false, eventHoist: false, dirtyMask: false, domPaths: options, htmlAot: false, cssMinifier: false, htmlMinifier: false },
      'DomPathsWebpackPlugin',
    );
  }
}

export function domPaths(options: DomPathsOptions = {}): DomPathsWebpackPlugin {
  return new DomPathsWebpackPlugin(options);
}

export class MemoizeWebpackPlugin extends LitWebpackPlugin {
  constructor(options: MemoizeOptions = {}) {
    super(
      { cssFuse: false, htmlFuse: false, propsLower: false, elemProxy: false, eventHoist: false, dirtyMask: false, memoize: options, htmlAot: false, cssMinifier: false, htmlMinifier: false },
      'MemoizeWebpackPlugin',
    );
  }
}

export function memoize(options: MemoizeOptions = {}): MemoizeWebpackPlugin {
  return new MemoizeWebpackPlugin(options);
}

export class DirectivesWebpackPlugin extends LitWebpackPlugin {
  constructor(options: DirectivesOptions = {}) {
    super(
      { cssFuse: false, htmlFuse: false, propsLower: false, elemProxy: false, eventHoist: false, dirtyMask: false, directives: options, htmlAot: false, cssMinifier: false, htmlMinifier: false },
      'DirectivesWebpackPlugin',
    );
  }
}

export function directives(options: DirectivesOptions = {}): DirectivesWebpackPlugin {
  return new DirectivesWebpackPlugin(options);
}

export function cssMinifier(options: CssMinifierOptions = {}): CssMinifierWebpackPlugin {
  return new CssMinifierWebpackPlugin(options);
}

export function htmlMinifier(options: HtmlMinifierOptions = {}): HtmlMinifierWebpackPlugin {
  return new HtmlMinifierWebpackPlugin(options);
}

export function htmlAot(options: HtmlAotOptions = {}): HtmlAotWebpackPlugin {
  return new HtmlAotWebpackPlugin(options);
}

export class ResumableWebpackPlugin extends LitWebpackPlugin {
  constructor(options: ResumableOptions = {}) {
    super(
      { cssFuse: false, htmlFuse: false, propsLower: false, elemProxy: false, eventHoist: false, dirtyMask: false, htmlAot: false, cssMinifier: false, htmlMinifier: false, resumable: options },
      'ResumableWebpackPlugin',
    );
  }
}

export function resumable(options: ResumableOptions = {}): ResumableWebpackPlugin {
  return new ResumableWebpackPlugin(options);
}

export class TagShakeWebpackPlugin extends LitWebpackPlugin {
  constructor(options: TagShakeOptions = {}) {
    super(
      { cssFuse: false, htmlFuse: false, propsLower: false, elemProxy: false, eventHoist: false, dirtyMask: false, htmlAot: false, cssMinifier: false, htmlMinifier: false, tagShake: options },
      'TagShakeWebpackPlugin',
    );
  }
}

export function tagShake(options: TagShakeOptions = {}): TagShakeWebpackPlugin {
  return new TagShakeWebpackPlugin(options);
}

export class SsrWebpackPlugin extends LitWebpackPlugin {
  constructor(options: SsrOptions = {}) {
    super(
      {
        cssFuse: false,
        htmlFuse: false,
        propsLower: false,
        elemProxy: false,
        eventHoist: false,
        dirtyMask: false,
        htmlAot: false,
        cssMinifier: false,
        htmlMinifier: false,
        ssr: options,
      },
      'SsrWebpackPlugin',
    );
  }
}

export function ssr(options: SsrOptions = {}): SsrWebpackPlugin {
  return new SsrWebpackPlugin(options);
}

export const litSsr = ssr;

export const LitCoreWebpackPlugin = LitWebpackPlugin;
export const litCoreWebpackPlugin = lit;
export const litCore = lit;
export const litCssFuse = cssFuse;
export const litHtmlFuse = htmlFuse;
export const litPropsLower = propsLower;
export const litElemProxy = elemProxy;
export const litEventHoist = eventHoist;
export const litDirtyMask = dirtyMask;
export const litDomPaths = domPaths;
export const litMemoize = memoize;
export const litDirectives = directives;
export const litCssMinifier = cssMinifier;
export const litHtmlMinifier = htmlMinifier;
export const litHtmlAot = htmlAot;
export const litResumable = resumable;
export const litTagShake = tagShake;

export default lit;
