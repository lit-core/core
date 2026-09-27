import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Compiler } from 'webpack';
import { registerPluginState, unregisterPluginState } from './loader.js';
import type {
  CssFuseOptions,
  CssMinifierOptions,
  ElemProxyOptions,
  EventHoistOptions,
  HtmlAotOptions,
  HtmlFuseOptions,
  HtmlMinifierOptions,
  LitPluginOptions,
  PropsLowerOptions,
  ResumableOptions,
} from './options.js';
import { runFuseOptimization, runHtmlFuseOptimization, runScopingAudit } from './transforms.js';
import { BARE_FUSED_ID_REGEX, BARE_HTML_FUSED_ID_REGEX, extractHtmlTemplateId, extractSheetId, isVirtualHtmlFusedId, VIRTUAL_FUSED_PREFIX, VIRTUAL_HTML_FUSED_PREFIX } from './utils.js';

let loaderPath = fileURLToPath(new URL('./loader.js', import.meta.url));
if (!fs.existsSync(loaderPath)) {
  const tsPath = fileURLToPath(new URL('./loader.ts', import.meta.url));
  if (fs.existsSync(tsPath)) {
    loaderPath = tsPath;
  }
}

let nextPluginId = 0;

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
    const htmlFuseOpt = options.htmlFuse ? (typeof options.htmlFuse === 'object' ? options.htmlFuse : {}) : null;

    // Register active state with the loader registry
    registerPluginState(this.id, {
      transformedFiles: this.transformedFiles,
      virtualSheets: this.virtualSheets,
      virtualTemplates: this.virtualTemplates,
      options: this.options,
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
            } catch (err) {
              logger.error(`[css-fuse] Optimization pass failed: ${err}`);
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
          } catch (err) {
            logger.error(`[html-fuse] Optimization pass failed: ${err}`);
          }
        }

        callback();
      });

      // Hook Webpack 5 virtual resource scheme loader
      compiler.hooks.compilation.tap(this.name, (compilation) => {
        const NormalModule = compiler.webpack?.NormalModule;
        if (NormalModule?.getCompilationHooks) {
          const hooks = NormalModule.getCompilationHooks(compilation);
          hooks.readResourceForScheme.for('virtual').tapPromise(this.name, async (resource: string) => {
            if (isVirtualHtmlFusedId(resource) || resource.includes('html-fuse')) {
              const templateId = extractHtmlTemplateId(resource);
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

            const sheetId = extractSheetId(resource);
            const code =
              this.virtualSheets.get(sheetId) || this.virtualSheets.get(path.basename(sheetId)) || this.virtualSheets.get(sheetId.replace(/\.js$/, '')) || this.virtualSheets.get(`${sheetId}.js`);

            if (code !== undefined) {
              return Buffer.from(code);
            }

            throw new Error(`[css-fuse] Virtual constructable stylesheet not found: ${resource}`);
          });
        }
      });

      // Redirect legacy or unprefixed imports to virtual:...
      compiler.hooks.normalModuleFactory.tap(this.name, (nmf) => {
        nmf.hooks.resolve.tap(this.name, (resolveData) => {
          if (!resolveData.request) return;
          if (BARE_HTML_FUSED_ID_REGEX.test(resolveData.request)) {
            const filename = resolveData.request.endsWith('.js') ? resolveData.request : `${resolveData.request}.js`;
            resolveData.request = `${VIRTUAL_HTML_FUSED_PREFIX}${filename}`;
          } else if (resolveData.request.startsWith('virtual:lit-html-fuse/')) {
            resolveData.request = resolveData.request.replace('virtual:lit-html-fuse/', VIRTUAL_HTML_FUSED_PREFIX);
          } else if (BARE_FUSED_ID_REGEX.test(resolveData.request)) {
            const filename = resolveData.request.endsWith('.js') ? resolveData.request : `${resolveData.request}.js`;
            resolveData.request = `${VIRTUAL_FUSED_PREFIX}${filename}`;
          } else if (resolveData.request.startsWith('virtual:lit-css-fuse/')) {
            resolveData.request = resolveData.request.replace('virtual:lit-css-fuse/', VIRTUAL_FUSED_PREFIX);
          }
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
    super({ cssFuse: false, htmlFuse: false, propsLower: false, elemProxy: false, eventHoist: options, htmlAot: false, cssMinifier: false, htmlMinifier: false }, 'EventHoistWebpackPlugin');
  }
}

export class HtmlAotWebpackPlugin extends LitWebpackPlugin {
  constructor(options: HtmlAotOptions = {}) {
    super({ cssFuse: false, htmlFuse: false, propsLower: false, htmlAot: options, cssMinifier: false, htmlMinifier: false }, 'HtmlAotWebpackPlugin');
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
      { cssFuse: false, htmlFuse: false, propsLower: false, elemProxy: false, eventHoist: false, htmlAot: false, cssMinifier: false, htmlMinifier: false, resumable: options },
      'ResumableWebpackPlugin',
    );
  }
}

export function resumable(options: ResumableOptions = {}): ResumableWebpackPlugin {
  return new ResumableWebpackPlugin(options);
}

export const litCore = lit;
export const litCssFuse = cssFuse;
export const litHtmlFuse = htmlFuse;
export const litPropsLower = propsLower;
export const litElemProxy = elemProxy;
export const litEventHoist = eventHoist;
export const litCssMinifier = cssMinifier;
export const litHtmlMinifier = htmlMinifier;
export const litHtmlAot = htmlAot;
export const litResumable = resumable;

export default lit;
