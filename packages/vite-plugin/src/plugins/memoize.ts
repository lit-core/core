import { transformMemoize } from '@lit-core/memoize';
import type { Plugin } from 'vite';
import type { MemoizeOptions } from '../options.js';
import { matchesPattern } from '../utils.js';

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
