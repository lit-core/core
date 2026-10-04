import fs from 'node:fs';
import path from 'node:path';
import { fuse as fuseHtml, type HtmlFuseResult } from '@lit-core/html-fuse';
import type { Plugin, ResolvedConfig } from 'vite';
import type { HtmlFuseOptions } from '../options.js';
import { extractHtmlTemplateId, formatVirtualHtmlId, isVirtualHtmlFusedId } from '../utils.js';

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

export const litHtmlFuse = htmlFuse;
