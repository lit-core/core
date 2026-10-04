import { transformDomPaths } from '@lit-core/dom-paths';
import type { Plugin } from 'vite';
import type { DomPathsOptions } from '../options.js';
import { matchesPattern } from '../utils.js';

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
