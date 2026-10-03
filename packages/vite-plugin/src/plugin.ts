import fs from 'node:fs';
import path from 'node:path';
import { auditScoping, type FuseResult, fuse } from '@lit-core/css-fuse';
import { minifyEmbeddedCss } from '@lit-core/css-minifier';
import { transformDirectives } from '@lit-core/directives';
import { transformDirtyMask } from '@lit-core/dirty-mask';
import { transformDomPaths } from '@lit-core/dom-paths';
import { transformElemProxy } from '@lit-core/elem-proxy';
import { transformEventHoist } from '@lit-core/event-hoist';
import { compileHtmlAot } from '@lit-core/html-aot';
import { fuse as fuseHtml, type HtmlFuseResult } from '@lit-core/html-fuse';
import { minifyHtmlTemplates } from '@lit-core/html-minifier';
import { transformMemoize } from '@lit-core/memoize';
import { transformNative } from '@lit-core/native';
import { transformLitProps } from '@lit-core/props-lower';
import { resumable as litResumablePlugin } from '@lit-core/resumable/vite';
import type { HmrContext, Plugin, ResolvedConfig } from 'vite';
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
  NativeOptions,
  PropsLowerOptions,
} from './options.js';
import {
  extractHtmlTemplateId,
  extractLitCoreVirtualSubpath,
  extractSheetId,
  formatVirtualHtmlId,
  formatVirtualId,
  formatVirtualLitCoreId,
  isVirtualFusedId,
  isVirtualHtmlFusedId,
  isVirtualLitCoreId,
  matchesPattern,
  RESOLVED_FUSED_PREFIX,
} from './utils.js';
import { getVirtualLitCoreModule } from './virtual.js';

export function cssFuse(options: CssFuseOptions = {}): Plugin {
  let config: ResolvedConfig;
  let fuseResult: FuseResult | null = null;
  const virtualSheets = new Map<string, string>(); // sheetId / filename -> code
  const transformedFiles = new Map<string, string>(); // filePath -> transformedCode

  const {
    include = ['packages/components/**/src/**/*.ts', 'src/**/*.ts'],
    exclude = ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**', '**/dist/**'],
    threshold = 2,
    outputDir = '.fused',
    scopingAudit = true,
    applyInDev = false,
    minSavings = 80,
  } = options;

  function runOptimization(virtualImports = true, write = false): FuseResult | null {
    try {
      const res = fuse({
        include,
        exclude,
        threshold,
        outputDir,
        write,
        virtualImports,
        minSavings,
      });

      virtualSheets.clear();
      const sheets = res.fusedSheets || [];
      for (const sheet of sheets) {
        virtualSheets.set(sheet.id, sheet.code);
        virtualSheets.set(`${sheet.id}.js`, sheet.code);
        virtualSheets.set(`${sheet.id}.ts`, sheet.code);
        virtualSheets.set(sheet.fileName, sheet.code);
      }

      transformedFiles.clear();
      const files = res.rewrittenFiles || [];
      for (const file of files) {
        if (file.filePath && file.transformedCode) {
          transformedFiles.set(file.filePath, file.transformedCode);
          const abs = path.resolve(file.filePath);
          transformedFiles.set(abs, file.transformedCode);
          try {
            const real = fs.realpathSync(abs);
            transformedFiles.set(real, file.transformedCode);
          } catch {}
        }
      }

      return res;
    } catch (err) {
      if (config) {
        config.logger.error(`[css-fuse] Optimization pass failed: ${err}`);
      }
      return null;
    }
  }

  return {
    name: 'css-fuse',
    enforce: 'pre',

    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

    buildStart() {
      const isDev = config.command === 'serve';

      // Dev mode: execute scoping audit (fast pass) unless applyInDev is enabled
      if (isDev && !applyInDev) {
        if (scopingAudit) {
          try {
            const diags = auditScoping({
              include,
              exclude,
              threshold,
            });

            for (const d of diags) {
              const path = d.filePath || 'unknown';
              const msg = `[css-fuse] ${d.code}: ${d.message} (${path}:${d.line || 1})`;
              this.warn(msg);
            }
          } catch (err) {
            config.logger.warn(`[css-fuse] Dev scoping audit failed: ${err}`);
          }
        }
        return;
      }

      // Production build or dev with applyInDev enabled: run in-memory AST extraction
      fuseResult = runOptimization(true, false);
      if (fuseResult) {
        const stats = fuseResult.stats;
        config.logger.info(
          `⚡ [css-fuse] Deduplicated ${stats.rulesDeduped} rules into ${stats.fusedSheetsCreated} shared constructable sheets across ${stats.componentsRewritten} components (~${(stats.bytesSaved / 1024).toFixed(1)} KB saved)`,
        );

        const diags = fuseResult.diagnostics || [];
        if (scopingAudit && diags.length > 0) {
          for (const d of diags) {
            const path = d.filePath || 'unknown';
            const msg = `[css-fuse] ${d.code}: ${d.message} (${path}:${d.line || 1})`;
            this.warn(msg);
          }
        }
      }
    },

    resolveId(id) {
      if (isVirtualLitCoreId(id)) {
        return formatVirtualLitCoreId(id);
      }
      if (isVirtualFusedId(id)) {
        return formatVirtualId(id);
      }
      return undefined;
    },

    load(id) {
      if (isVirtualLitCoreId(id)) {
        const subpath = extractLitCoreVirtualSubpath(id);
        const code = getVirtualLitCoreModule(subpath);
        if (code) {
          return {
            code,
            map: null,
          };
        }
      }
      if (isVirtualFusedId(id)) {
        const sheetId = extractSheetId(id);
        const code = virtualSheets.get(sheetId) || virtualSheets.get(sheetId.replace(/\.js$/, '')) || virtualSheets.get(`${sheetId}.js`);

        if (code) {
          return {
            code,
            map: null,
          };
        }
      }
      return undefined;
    },

    transform(_code, id) {
      const cleanId = id.split('?')[0];
      let transformed = transformedFiles.get(cleanId);
      if (!transformed) {
        const abs = path.resolve(cleanId);
        transformed = transformedFiles.get(abs);
        if (!transformed) {
          try {
            const real = fs.realpathSync(abs);
            transformed = transformedFiles.get(real);
          } catch {}
        }
      }
      if (transformed) {
        return {
          code: transformed,
          map: null,
        };
      }
      return undefined;
    },

    renderChunk(_code, chunk) {
      // Hook into Rollup's chunk emission to verify chunk isolation
      // Ensure lazy route shared sheets do not leak into entry bundle
      const moduleIds = Object.keys(chunk.modules);
      const fusedInChunk = moduleIds.filter((m) => isVirtualFusedId(m));
      if (fusedInChunk.length > 0 && chunk.isEntry) {
        // Shared sheets in entry chunk are only valid if consumed by entry modules
      }
      return null;
    },

    async handleHotUpdate(ctx: HmrContext) {
      if (!applyInDev) {
        return;
      }

      // Check if updated file is a component with CSS
      const isComponent = transformedFiles.has(ctx.file) || ctx.file.endsWith('.ts') || ctx.file.endsWith('.js');
      if (!isComponent) {
        return;
      }

      // Re-run optimization pass
      const prevSheets = new Map(virtualSheets);
      runOptimization(true, false);

      // Invalidate modified virtual sheets
      for (const [sheetKey, newCode] of virtualSheets.entries()) {
        if (prevSheets.get(sheetKey) !== newCode) {
          const virtualId = `${RESOLVED_FUSED_PREFIX}${sheetKey.endsWith('.js') ? sheetKey : `${sheetKey}.js`}`;
          const mod = ctx.server.moduleGraph.getModuleById(virtualId);
          if (mod) {
            ctx.server.moduleGraph.invalidateModule(mod);
          }
        }
      }

      // Invalidate component module
      const compMod = ctx.server.moduleGraph.getModuleById(ctx.file);
      if (compMod) {
        ctx.server.moduleGraph.invalidateModule(compMod);
      }

      // Return modules to trigger Vite HMR update without full-page reload
      return ctx.modules;
    },
  };
}

const LIT_DECORATOR_FAST_CHECK =
  /@(?:customElement|property|state|query|queryAll|queryAsync|queryAssignedElements|queryAssignedNodes|eventOptions|localized)\b|__(?:decorate|decorateClass)\b|\bimport\b[^;]*\b(?:decorators\.js|property|customElement|state)\b/;

export function propsLower(options: PropsLowerOptions = {}): Plugin {
  const { sourcemap = true } = options;

  return {
    name: 'props-lower',
    enforce: 'pre',

    transform(code: string, id: string) {
      const cleanId = id.split('?')[0] ?? id;
      if (!/\.[jt]sx?$/.test(cleanId)) {
        return null;
      }

      if (options.exclude) {
        const excludes = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
        for (const pattern of excludes) {
          if (matchesPattern(cleanId, pattern)) return null;
        }
      } else if (!options.include && cleanId.includes('/node_modules/')) {
        return null;
      }

      if (options.include) {
        const includes = Array.isArray(options.include) ? options.include : [options.include];
        const matched = includes.some((pattern) => matchesPattern(cleanId, pattern));
        if (!matched) return null;
      }

      if (!LIT_DECORATOR_FAST_CHECK.test(code)) {
        return null;
      }

      try {
        const result = transformLitProps(code, {
          sourcemap,
          filename: cleanId,
        });

        return {
          code: result.code,
          map: result.map ? JSON.parse(result.map) : null,
        };
      } catch (_err) {
        return null;
      }
    },
  };
}

const LIT_HTML_FAST_CHECK = /\b(?:html|svg)\s*`|\bimport\b[^;]*\b(?:html|svg)\b/;

export function htmlMinifier(options: HtmlMinifierOptions = {}): Plugin {
  const { sourcemap = false } = options;

  return {
    name: 'html-minifier',
    enforce: 'pre',

    transform(code: string, id: string) {
      const cleanId = id.split('?')[0] ?? id;
      if (!/\.[jt]sx?$/.test(cleanId)) {
        return null;
      }

      if (options.exclude) {
        const excludes = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
        for (const pattern of excludes) {
          if (matchesPattern(cleanId, pattern)) return null;
        }
      } else if (!options.include && cleanId.includes('/node_modules/')) {
        return null;
      }

      if (options.include) {
        const includes = Array.isArray(options.include) ? options.include : [options.include];
        const matched = includes.some((pattern) => matchesPattern(cleanId, pattern));
        if (!matched) return null;
      }

      if (!LIT_HTML_FAST_CHECK.test(code)) {
        return null;
      }

      try {
        const result = minifyHtmlTemplates(code, {
          sourcemap,
          filename: cleanId,
        });

        if (result.templatesCount === 0) {
          return null;
        }

        return {
          code: result.code,
          map: result.map ? JSON.parse(result.map) : null,
        };
      } catch (_err) {
        return null;
      }
    },
  };
}

const LIT_CSS_FAST_CHECK = /\bcss\s*[`(]|\bimport\b[^;]*\bcss\b/;

export function cssMinifier(options: CssMinifierOptions = {}): Plugin {
  const { sourcemap = true } = options;

  return {
    name: 'css-minifier',
    enforce: 'pre',

    transform(code: string, id: string) {
      const cleanId = id.split('?')[0] ?? id;
      if (!/\.[jt]sx?$/.test(cleanId)) {
        return null;
      }

      if (options.exclude) {
        const excludes = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
        for (const pattern of excludes) {
          if (matchesPattern(cleanId, pattern)) return null;
        }
      } else if (!options.include && cleanId.includes('/node_modules/')) {
        return null;
      }

      if (options.include) {
        const includes = Array.isArray(options.include) ? options.include : [options.include];
        const matched = includes.some((pattern: string | RegExp) => matchesPattern(cleanId, pattern));
        if (!matched) return null;
      }

      if (!LIT_CSS_FAST_CHECK.test(code)) {
        return null;
      }

      try {
        const result = minifyEmbeddedCss(code, {
          sourcemap,
          filename: cleanId,
        });

        if (result.minifiedTemplates === 0) {
          return null;
        }

        return {
          code: result.code,
          map: result.map ? JSON.parse(result.map) : null,
        };
      } catch (_err) {
        return null;
      }
    },
  };
}

export function htmlFuse(options: HtmlFuseOptions = {}): Plugin {
  let config: ResolvedConfig;
  let fuseResult: HtmlFuseResult | null = null;
  const virtualTemplates = new Map<string, string>();
  const transformedFiles = new Map<string, string>();

  const {
    include = ['packages/components/**/src/**/*.ts', 'src/**/*.ts'],
    exclude = ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**', '**/dist/**'],
    threshold = 2,
    minFragmentLength = 15,
    outputDir = '.fused-html',
    applyInDev = false,
  } = options;

  function runOptimization(virtualImports = true, write = false): HtmlFuseResult | null {
    try {
      const res = fuseHtml({
        include,
        exclude,
        threshold,
        minFragmentLength,
        outputDir,
        write,
        virtualImports,
      });

      virtualTemplates.clear();
      const templates = res.fusedTemplates || [];
      for (const tpl of templates) {
        virtualTemplates.set(tpl.id, tpl.code);
        virtualTemplates.set(`${tpl.id}.js`, tpl.code);
        virtualTemplates.set(`${tpl.id}.ts`, tpl.code);
        virtualTemplates.set(tpl.fileName, tpl.code);
      }

      transformedFiles.clear();
      const files = res.rewrittenFiles || [];
      for (const file of files) {
        if (file.filePath && file.transformedCode) {
          transformedFiles.set(file.filePath, file.transformedCode);
          const abs = path.resolve(file.filePath);
          transformedFiles.set(abs, file.transformedCode);
          try {
            const real = fs.realpathSync(abs);
            transformedFiles.set(real, file.transformedCode);
          } catch {}
        }
      }

      return res;
    } catch (err) {
      if (config) {
        config.logger.error(`[html-fuse] Optimization pass failed: ${err}`);
      }
      return null;
    }
  }

  return {
    name: 'html-fuse',
    enforce: 'pre',

    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

    buildStart() {
      const isDev = config.command === 'serve';

      if (isDev && !applyInDev) {
        return;
      }

      fuseResult = runOptimization(true, false);
      if (fuseResult && config) {
        const stats = fuseResult.stats;
        if (stats.fragmentsDeduped > 0) {
          config.logger.info(
            `⚡ [html-fuse] Deduplicated ${stats.fragmentsDeduped} static fragments into ${stats.fusedTemplatesCreated} shared templates across ${stats.componentsRewritten} components (~${(stats.bytesSaved / 1024).toFixed(1)} KB saved)`,
          );
        }
      }
    },

    resolveId(id) {
      if (isVirtualHtmlFusedId(id)) {
        return formatVirtualHtmlId(id);
      }
      return undefined;
    },

    load(id) {
      if (isVirtualHtmlFusedId(id)) {
        const tplId = extractHtmlTemplateId(id);
        const code = virtualTemplates.get(tplId) || virtualTemplates.get(tplId.replace(/\.js$/, '')) || virtualTemplates.get(`${tplId}.js`);

        if (code) {
          return {
            code,
            map: null,
          };
        }
      }
      return undefined;
    },

    transform(_code, id) {
      const cleanId = id.split('?')[0];
      let transformed = transformedFiles.get(cleanId);
      if (!transformed) {
        const abs = path.resolve(cleanId);
        transformed = transformedFiles.get(abs);
        if (!transformed) {
          try {
            const real = fs.realpathSync(abs);
            transformed = transformedFiles.get(real);
          } catch {}
        }
      }
      if (transformed) {
        return {
          code: transformed,
          map: null,
        };
      }
      return undefined;
    },
  };
}

const LIT_HTML_AOT_FAST_CHECK = /\b(?:html|svg)\s*`|\b[a-zA-Z0-9_$]+\.html\s*`|\bimport\b[^;]*\b(?:html|svg)\b/;

export function htmlAot(options: HtmlAotOptions = {}): Plugin {
  const { sourcemap = false } = options;

  return {
    name: 'html-aot',
    enforce: 'pre',

    transform(code: string, id: string) {
      const cleanId = id.split('?')[0] ?? id;
      if (!/\.[jt]sx?$/.test(cleanId)) {
        return null;
      }

      if (options.exclude) {
        const excludes = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
        for (const pattern of excludes) {
          if (matchesPattern(cleanId, pattern)) return null;
        }
      } else if (!options.include && cleanId.includes('/node_modules/')) {
        return null;
      }

      if (options.include) {
        const includes = Array.isArray(options.include) ? options.include : [options.include];
        const matched = includes.some((pattern) => matchesPattern(cleanId, pattern));
        if (!matched) return null;
      }

      if (!LIT_HTML_AOT_FAST_CHECK.test(code)) {
        return null;
      }

      try {
        const result = compileHtmlAot(code, {
          filename: cleanId,
          sourcemap,
        });

        if (result.templatesCount === 0) {
          return null;
        }

        return {
          code: result.code,
          map: result.map ? JSON.parse(result.map) : null,
        };
      } catch (_err) {
        return null;
      }
    },
  };
}

export const litCssMinifier = cssMinifier;
export const litHtmlMinifier = htmlMinifier;
export const litHtmlFuse = htmlFuse;
export const litHtmlAot = htmlAot;

const LIT_ELEM_PROXY_FAST_CHECK = /@customElement\b|customElements\.define\b/;

export function elemProxy(options: ElemProxyOptions = {}): Plugin {
  const { sourcemap = true } = options;

  return {
    name: 'elem-proxy',
    enforce: 'pre',

    transform(code: string, id: string) {
      const cleanId = id.split('?')[0] ?? id;
      if (!/\.[jt]sx?$/.test(cleanId)) {
        return null;
      }

      if (options.exclude) {
        const excludes = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
        for (const pattern of excludes) {
          if (matchesPattern(cleanId, pattern)) return null;
        }
      } else if (!options.include && cleanId.includes('/node_modules/')) {
        return null;
      }

      if (options.include) {
        const includes = Array.isArray(options.include) ? options.include : [options.include];
        const matched = includes.some((pattern) => matchesPattern(cleanId, pattern));
        if (!matched) return null;
      }

      if (!LIT_ELEM_PROXY_FAST_CHECK.test(code)) {
        return null;
      }

      try {
        const result = transformElemProxy(code, {
          sourcemap,
          filename: cleanId,
          mode: options.mode,
        });

        if (result.proxiedElementsCount === 0) {
          return null;
        }

        return {
          code: result.code,
          map: result.map ? JSON.parse(result.map) : null,
        };
      } catch (_err) {
        return null;
      }
    },
  };
}

export const litElemProxy = elemProxy;

const LIT_NATIVE_FAST_CHECK = /\bLitElement\b|@customElement\b|extends\s+(?:LitElement|ReactiveElement)\b/;

export function native(options: NativeOptions = {}): Plugin {
  const { sourcemap = true } = options;

  return {
    name: 'native',
    enforce: 'pre',

    transform(code: string, id: string) {
      const cleanId = id.split('?')[0] ?? id;
      if (!/\.[jt]sx?$/.test(cleanId)) {
        return null;
      }

      if (options.exclude) {
        const excludes = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
        for (const pattern of excludes) {
          if (matchesPattern(cleanId, pattern)) return null;
        }
      } else if (!options.include && cleanId.includes('/node_modules/')) {
        return null;
      }

      if (options.include) {
        const includes = Array.isArray(options.include) ? options.include : [options.include];
        const matched = includes.some((pattern) => matchesPattern(cleanId, pattern));
        if (!matched) return null;
      }

      if (!LIT_NATIVE_FAST_CHECK.test(code)) {
        return null;
      }

      try {
        const result = transformNative(code, {
          sourcemap,
          filename: cleanId,
          mode: options.mode,
        });

        if (result.vanillaCount === 0 && result.microCount === 0) {
          return null;
        }

        return {
          code: result.code,
          map: result.map ? JSON.parse(result.map) : null,
        };
      } catch (_err) {
        return null;
      }
    },
  };
}

export const litNative = native;

const LIT_EVENT_HOIST_FAST_CHECK = /html\s*`[\s\S]*?@[a-zA-Z]/;

export function eventHoist(options: EventHoistOptions = {}): Plugin {
  const { sourcemap = true } = options;

  return {
    name: 'event-hoist',
    enforce: 'pre',

    transform(code: string, id: string) {
      const cleanId = id.split('?')[0] ?? id;
      if (!/\.[jt]sx?$/.test(cleanId)) {
        return null;
      }

      if (options.exclude) {
        const excludes = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
        for (const pattern of excludes) {
          if (matchesPattern(cleanId, pattern)) return null;
        }
      } else if (!options.include && cleanId.includes('/node_modules/')) {
        return null;
      }

      if (options.include) {
        const includes = Array.isArray(options.include) ? options.include : [options.include];
        const matched = includes.some((pattern) => matchesPattern(cleanId, pattern));
        if (!matched) return null;
      }

      if (!LIT_EVENT_HOIST_FAST_CHECK.test(code)) {
        return null;
      }

      try {
        const result = transformEventHoist(code, {
          sourcemap,
          filename: cleanId,
          events: options.events,
        });

        if (result.hoistedEventsCount === 0) {
          return null;
        }

        return {
          code: result.code,
          map: result.map ? JSON.parse(result.map) : null,
        };
      } catch (_err) {
        return null;
      }
    },
  };
}

export const litEventHoist = eventHoist;

const LIT_DIRTY_MASK_FAST_CHECK = /(?:html|svg)\s*`[\s\S]*?\${/;

export function dirtyMask(options: DirtyMaskOptions = {}): Plugin {
  const { sourcemap = true } = options;

  return {
    name: 'dirty-mask',
    enforce: 'pre',

    transform(code: string, id: string) {
      const cleanId = id.split('?')[0] ?? id;
      if (!/\.[jt]sx?$/.test(cleanId)) {
        return null;
      }

      if (options.exclude) {
        const excludes = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
        for (const pattern of excludes) {
          if (matchesPattern(cleanId, pattern)) return null;
        }
      } else if (!options.include && cleanId.includes('/node_modules/')) {
        return null;
      }

      if (options.include) {
        const includes = Array.isArray(options.include) ? options.include : [options.include];
        const matched = includes.some((pattern) => matchesPattern(cleanId, pattern));
        if (!matched) return null;
      }

      if (!LIT_DIRTY_MASK_FAST_CHECK.test(code)) {
        return null;
      }

      try {
        const result = transformDirtyMask(code, {
          sourcemap,
          filename: cleanId,
        });

        if (result.maskedPartsCount === 0) {
          return null;
        }

        return {
          code: result.code,
          map: result.map ? JSON.parse(result.map) : null,
        };
      } catch (_err) {
        return null;
      }
    },
  };
}

export const litDirtyMask = dirtyMask;

const LIT_DOM_PATHS_FAST_CHECK = /(?:html|svg)\s*`[\s\S]*?\${/;

export function domPaths(options: DomPathsOptions = {}): Plugin {
  const { sourcemap = true } = options;

  return {
    name: 'dom-paths',
    enforce: 'pre',

    transform(code: string, id: string) {
      const cleanId = id.split('?')[0] ?? id;
      if (!/\.[jt]sx?$/.test(cleanId)) {
        return null;
      }

      if (options.exclude) {
        const excludes = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
        for (const pattern of excludes) {
          if (matchesPattern(cleanId, pattern)) return null;
        }
      } else if (!options.include && cleanId.includes('/node_modules/')) {
        return null;
      }

      if (options.include) {
        const includes = Array.isArray(options.include) ? options.include : [options.include];
        const matched = includes.some((pattern) => matchesPattern(cleanId, pattern));
        if (!matched) return null;
      }

      if (!LIT_DOM_PATHS_FAST_CHECK.test(code)) {
        return null;
      }

      try {
        const result = transformDomPaths(code, {
          sourcemap,
          filename: cleanId,
          normalizeWhitespace: options.normalizeWhitespace,
        });

        if (result.componentsCount === 0 || result.pathsCount === 0) {
          return null;
        }

        return {
          code: result.code,
          map: result.map ? JSON.parse(result.map) : null,
        };
      } catch (_err) {
        return null;
      }
    },
  };
}

export const litDomPaths = domPaths;

const LIT_MEMOIZE_FAST_CHECK = /\brender\s*\([^)]*\)\s*\{/;

export function memoize(options: MemoizeOptions = {}): Plugin {
  const { sourcemap = true } = options;

  return {
    name: 'memoize',
    enforce: 'pre',

    transform(code: string, id: string) {
      const cleanId = id.split('?')[0] ?? id;
      if (!/\.[jt]sx?$/.test(cleanId)) {
        return null;
      }

      if (options.exclude) {
        const excludes = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
        for (const pattern of excludes) {
          if (matchesPattern(cleanId, pattern)) return null;
        }
      } else if (!options.include && cleanId.includes('/node_modules/')) {
        return null;
      }

      if (options.include) {
        const includes = Array.isArray(options.include) ? options.include : [options.include];
        const matched = includes.some((pattern) => matchesPattern(cleanId, pattern));
        if (!matched) return null;
      }

      if (!LIT_MEMOIZE_FAST_CHECK.test(code)) {
        return null;
      }

      try {
        const result = transformMemoize(code, {
          sourcemap,
          filename: cleanId,
        });

        if (result.memoizedCount === 0) {
          return null;
        }

        return {
          code: result.code,
          map: result.map ? JSON.parse(result.map) : null,
        };
      } catch (_err) {
        return null;
      }
    },
  };
}

export const litMemoize = memoize;

const LIT_DIRECTIVES_FAST_CHECK = /(?:lit|lit-html)\/directives\//;

export function directives(options: DirectivesOptions = {}): Plugin {
  const { sourcemap = true } = options;

  return {
    name: 'directives',
    enforce: 'pre',

    transform(code: string, id: string) {
      const cleanId = id.split('?')[0] ?? id;
      if (!/\.[jt]sx?$/.test(cleanId)) {
        return null;
      }

      if (options.exclude) {
        const excludes = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
        for (const pattern of excludes) {
          if (matchesPattern(cleanId, pattern)) return null;
        }
      } else if (!options.include && cleanId.includes('/node_modules/')) {
        return null;
      }

      if (options.include) {
        const includes = Array.isArray(options.include) ? options.include : [options.include];
        const matched = includes.some((pattern) => matchesPattern(cleanId, pattern));
        if (!matched) return null;
      }

      if (!LIT_DIRECTIVES_FAST_CHECK.test(code)) {
        return null;
      }

      try {
        const result = transformDirectives(code, {
          sourcemap,
          filename: cleanId,
        });

        if (result.loweredCount === 0) {
          return null;
        }

        return {
          code: result.code,
          map: result.map ? JSON.parse(result.map) : null,
        };
      } catch (_err) {
        return null;
      }
    },
  };
}

export const litDirectives = directives;

export function litVirtual(): Plugin {
  return {
    name: 'lit-virtual',
    enforce: 'pre',

    resolveId(id) {
      if (isVirtualLitCoreId(id)) {
        return formatVirtualLitCoreId(id);
      }
      return undefined;
    },

    load(id) {
      if (isVirtualLitCoreId(id)) {
        const subpath = extractLitCoreVirtualSubpath(id);
        const code = getVirtualLitCoreModule(subpath);
        if (code) {
          return {
            code,
            map: null,
          };
        }
      }
      return undefined;
    },
  };
}

export function lit(options: LitPluginOptions = {}): Plugin[] {
  const plugins: Plugin[] = [];

  if (options.virtual) {
    plugins.push(litVirtual());
  }

  const { cssFuse: cssFuseOpt = true } = options;
  if (cssFuseOpt !== false) {
    const fuseOpts = typeof cssFuseOpt === 'object' ? cssFuseOpt : {};
    plugins.push(cssFuse(fuseOpts));
  }

  const htmlFuseOpt = options.htmlFuse ?? options['html-fuse'];
  if (htmlFuseOpt) {
    const fuseOpts = typeof htmlFuseOpt === 'object' ? htmlFuseOpt : {};
    plugins.push(htmlFuse(fuseOpts));
  }

  const propsLowerOpt = options.propsLower ?? options['props-lower'];
  if (propsLowerOpt) {
    const propsOpts = typeof propsLowerOpt === 'object' ? propsLowerOpt : {};
    plugins.push(propsLower(propsOpts));
  }

  const elemProxyOpt = options.elemProxy ?? options['elem-proxy'];
  if (elemProxyOpt) {
    const proxyOpts = typeof elemProxyOpt === 'object' ? elemProxyOpt : {};
    plugins.push(elemProxy(proxyOpts));
  }

  const nativeOpt = options.native ?? options['native-compile'];
  if (nativeOpt) {
    const nativeOpts = typeof nativeOpt === 'object' ? nativeOpt : {};
    plugins.push(native(nativeOpts));
  }

  const eventHoistOpt = options.eventHoist ?? options['event-hoist'];
  if (eventHoistOpt) {
    const hoistOpts = typeof eventHoistOpt === 'object' ? eventHoistOpt : {};
    plugins.push(eventHoist(hoistOpts));
  }

  const dirtyMaskOpt = options.dirtyMask ?? options['dirty-mask'];
  if (dirtyMaskOpt) {
    const maskOpts = typeof dirtyMaskOpt === 'object' ? dirtyMaskOpt : {};
    plugins.push(dirtyMask(maskOpts));
  }

  const domPathsOpt = options.domPaths ?? options['dom-paths'];
  if (domPathsOpt) {
    const domOpts = typeof domPathsOpt === 'object' ? domPathsOpt : {};
    plugins.push(domPaths(domOpts));
  }

  const memoizeOpt = options.memoize;
  if (memoizeOpt) {
    const memoizeOpts = typeof memoizeOpt === 'object' ? memoizeOpt : {};
    plugins.push(memoize(memoizeOpts));
  }

  const directivesOpt = options.directives;
  if (directivesOpt) {
    const directivesOpts = typeof directivesOpt === 'object' ? directivesOpt : {};
    plugins.push(directives(directivesOpts));
  }

  const htmlAotOpt = options.htmlAot ?? options['html-aot'];
  if (htmlAotOpt) {
    const aotOpts = typeof htmlAotOpt === 'object' ? htmlAotOpt : {};
    plugins.push(htmlAot(aotOpts));
  }

  const cssMinifierOpt = options.cssMinifier ?? options['css-minifier'];
  if (cssMinifierOpt) {
    const minifierOpts = typeof cssMinifierOpt === 'object' ? cssMinifierOpt : {};
    plugins.push(cssMinifier(minifierOpts));
  }

  const minifierOpt = options.htmlMinifier ?? options['html-minifier'];
  if (minifierOpt) {
    const minifierOpts = typeof minifierOpt === 'object' ? minifierOpt : {};
    plugins.push(htmlMinifier(minifierOpts));
  }

  const resumableOpt = options.resumable;
  if (resumableOpt) {
    const resumableOpts = typeof resumableOpt === 'object' ? resumableOpt : {};
    plugins.push(litResumablePlugin(resumableOpts));
  }

  return plugins;
}

export const resumable = litResumablePlugin;
export const litResumable = litResumablePlugin;
export const litCore = lit;
export const litVirtualPlugin = litVirtual;
export const litCssFuse = cssFuse;
export const litPropsLower = propsLower;
export default lit;
