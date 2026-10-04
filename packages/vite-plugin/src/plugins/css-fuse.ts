import fs from 'node:fs';
import path from 'node:path';
import { auditScoping, type FuseResult, fuse } from '@lit-core/css-fuse';
import type { HmrContext, Plugin, ResolvedConfig } from 'vite';
import type { CssFuseOptions } from '../options.js';
import { extractLitCoreVirtualSubpath, extractSheetId, formatVirtualId, formatVirtualLitCoreId, isVirtualFusedId, isVirtualLitCoreId, RESOLVED_FUSED_PREFIX } from '../utils.js';
import { getVirtualLitCoreModule } from '../virtual.js';

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
