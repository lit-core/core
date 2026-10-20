import { createRequire } from 'node:module';
import { compileHtmlAot } from '@lit-core/html-aot';
import { minifyHtmlTemplates } from '@lit-core/html-minifier';
import type { Plugin } from 'vite';
import { reportTransformError } from '../errors.js';
import type { HtmlAotOptions } from '../options.js';
import { matchesPattern } from '../utils.js';

const LIT_HTML_AOT_FAST_CHECK = /\b(?:html|svg)\s*`|\b[a-zA-Z0-9_$]+\.html\s*`|\bimport\b[^;]*\b(?:html|svg)\b/;
const esmRequire = createRequire(import.meta.url);

export function htmlAot(options: HtmlAotOptions = {}): Plugin {
  const { sourcemap = false } = options;

  return {
    name: 'html-aot',
    enforce: 'pre',

    resolveId(id: string) {
      if (id === 'lit-html/private-ssr-support.js') {
        try {
          return esmRequire.resolve('lit-html/private-ssr-support.js');
        } catch {
          try {
            const litEntry = esmRequire.resolve('lit');
            const litRequire = createRequire(litEntry);
            return litRequire.resolve('lit-html/private-ssr-support.js');
          } catch {}
        }
      }
      return null;
    },

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
        let inputCode = code;
        try {
          const minified = minifyHtmlTemplates(code, {
            sourcemap: false,
            filename: cleanId,
          });
          if (minified.templatesCount > 0) {
            inputCode = minified.code;
          }
        } catch {}

        const result = compileHtmlAot(inputCode, {
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
      } catch (err) {
        reportTransformError(this, 'html-aot', cleanId, err);
      }
    },
  };
}

export const litHtmlAot = htmlAot;
