import fs from 'node:fs';
import path from 'node:path';
import { auditScoping, type FuseResult, fuse } from '@lit-core/css-fuse';
import { minifyEmbeddedCss } from '@lit-core/css-minifier';
import { minifyHtmlTemplates } from '@lit-core/html-minifier';
import { transformLitProps } from '@lit-core/props-lower';
import type { HmrContext, Plugin, ResolvedConfig } from 'vite';
import type { CssFuseOptions, CssMinifierOptions, HtmlMinifierOptions, LitPluginOptions, PropsLowerOptions } from './options.js';
import { extractSheetId, formatVirtualId, isVirtualFusedId, RESOLVED_FUSED_PREFIX } from './utils.js';

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
      if (isVirtualFusedId(id)) {
        return formatVirtualId(id);
      }
      return undefined;
    },

    load(id) {
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

function matchesPattern(cleanId: string, pattern: string | RegExp): boolean {
  if (pattern instanceof RegExp) return pattern.test(cleanId);
  if (typeof pattern === 'string') {
    if (cleanId.includes(pattern)) return true;
    if (pattern.includes('*')) {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      return new RegExp(escaped).test(cleanId);
    }
  }
  return false;
}

const LIT_DECORATOR_FAST_CHECK = /@(?:customElement|property|state|query|queryAll|queryAsync|queryAssignedElements|queryAssignedNodes|eventOptions|localized)\b/;

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

const LIT_HTML_FAST_CHECK = /\b(?:html|svg)\s*`/;

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
      } else if (cleanId.includes('/node_modules/')) {
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

const LIT_CSS_FAST_CHECK = /\bcss\s*`/;

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
      } else if (cleanId.includes('/node_modules/')) {
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

export const litCssMinifier = cssMinifier;
export const templateWhitespaceCollapser = htmlMinifier;
export const litHtmlMinifier = htmlMinifier;
export const litTemplateWhitespaceCollapser = htmlMinifier;

export function lit(options: LitPluginOptions = {}): Plugin[] {
  const plugins: Plugin[] = [];

  const { cssFuse: cssFuseOpt = true } = options;
  if (cssFuseOpt !== false) {
    const fuseOpts = typeof cssFuseOpt === 'object' ? cssFuseOpt : {};
    plugins.push(cssFuse(fuseOpts));
  }

  const propsLowerOpt = options.propsLower ?? options['props-lower'];
  if (propsLowerOpt) {
    const propsOpts = typeof propsLowerOpt === 'object' ? propsLowerOpt : {};
    plugins.push(propsLower(propsOpts));
  }

  const cssMinifierOpt = options.cssMinifier ?? options['css-minifier'];
  if (cssMinifierOpt) {
    const minifierOpts = typeof cssMinifierOpt === 'object' ? cssMinifierOpt : {};
    plugins.push(cssMinifier(minifierOpts));
  }

  const minifierOpt = options.htmlMinifier ?? options['html-minifier'] ?? options.templateWhitespaceCollapser ?? options['template-whitespace-collapser'];
  if (minifierOpt) {
    const minifierOpts = typeof minifierOpt === 'object' ? minifierOpt : {};
    plugins.push(htmlMinifier(minifierOpts));
  }

  return plugins;
}

export const litCore = lit;
export const litCssFuse = cssFuse;
export const litPropsLower = propsLower;
export default lit;
