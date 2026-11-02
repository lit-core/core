import { compileHtmlAot } from '@lit-core/html-aot';
import { minifyHtmlTemplates } from '@lit-core/html-minifier';
import { resolveLitPrivateSsrSupportForVite } from '@lit-core/resumable/vite';
import type { Plugin, ResolvedConfig } from 'vite';
import { reportTransformError } from '../errors.js';
import type { HtmlAotOptions } from '../options.js';
import { isVirtualHtmlFusedId, matchesPattern } from '../utils.js';

const LIT_HTML_AOT_FAST_CHECK = /\b(?:html|svg)\s*`|\b[a-zA-Z0-9_$]+\.html\s*`|\bimport\b[^;]*\b(?:html|svg)\b|\b(?:static-html|lit-html\/(?:development\/)?static)\b/;

export interface HtmlAotInternalOptions extends HtmlAotOptions {
  ssrOnly?: boolean;
  onRuntimeTemplatesDetected?: (id: string) => void;
}

function resolveIsSsrTarget(
  pluginCtx: { environment?: { name: string } },
  config: ResolvedConfig | undefined,
  transformOpts: { ssr?: boolean } | undefined,
  id: string,
  explicitSsr?: boolean,
): boolean {
  if (explicitSsr !== undefined) {
    return explicitSsr;
  }
  if (/[?&]lit-client\b/.test(id)) return false;
  if (/[?&](?:lit-worker|lit-server|worker|ssr)\b/.test(id)) return true;
  if (pluginCtx.environment) {
    return pluginCtx.environment.name !== 'client';
  }
  if (transformOpts?.ssr === true) {
    return true;
  }
  if (config?.build?.ssr) {
    return true;
  }
  return false;
}

export function htmlAot(options: HtmlAotInternalOptions = {}): Plugin {
  const { sourcemap = false } = options;
  let config: ResolvedConfig | undefined;

  return {
    name: 'html-aot',
    enforce: 'pre',

    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

    resolveId(id: string, importer?: string, resolveOpts?: { ssr?: boolean }) {
      if (id === 'lit-html/private-ssr-support.js') {
        const isSsr = resolveIsSsrTarget(this, config, resolveOpts, id, options.ssr);
        const conditions = config?.resolve?.conditions ?? [];
        const isDev = Boolean(conditions.includes('development') || (!conditions.includes('production') && config?.mode === 'development'));
        return resolveLitPrivateSsrSupportForVite(config?.root, isSsr, isDev, this as any, importer, resolveOpts as any) ?? null;
      }
      return null;
    },

    transform(code: string, id: string, transformOpts?: { ssr?: boolean }) {
      const cleanId = id.split('?')[0] ?? id;
      const isVirtualHtml = isVirtualHtmlFusedId(cleanId);
      if (!isVirtualHtml && !/\.[cm]?[jt]sx?$/.test(cleanId)) {
        return null;
      }

      const isSsr = resolveIsSsrTarget(this, config, transformOpts, id, options.ssr);
      if (options.ssrOnly && !isSsr) {
        return null;
      }

      if (!isVirtualHtml) {
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
      }

      if (!LIT_HTML_AOT_FAST_CHECK.test(code)) {
        return null;
      }

      const safeFilename = cleanId.replace(/^\0/, '');
      const strictSsr = options.strictSsr ?? isSsr;

      try {
        let inputCode = code;
        if (options.minify !== false) {
          try {
            const minified = minifyHtmlTemplates(code, {
              sourcemap: false,
              filename: safeFilename,
            });
            if (minified.templatesCount > 0) {
              inputCode = minified.code;
            }
          } catch (minifyError) {
            // Minification is an optimization. The unminified template is still compiled correctly,
            // but a failure must be visible rather than silently discarded.
            this.warn(`[html-aot] html minification skipped for ${safeFilename}: ${minifyError instanceof Error ? minifyError.message : String(minifyError)}`);
          }
        }

        const result = compileHtmlAot(inputCode, {
          filename: safeFilename,
          sourcemap,
          ssr: isSsr,
          strictSsr,
        });

        if (isSsr && result.hasRuntimeTemplates) {
          options.onRuntimeTemplatesDetected?.(cleanId);
        }

        if (result.templatesCount === 0) {
          return null;
        }

        return {
          code: result.code,
          map: result.map ? JSON.parse(result.map) : null,
        };
      } catch (err) {
        reportTransformError(this, 'html-aot', cleanId, err);
      }
    },
  };
}

export const litHtmlAot = htmlAot;
