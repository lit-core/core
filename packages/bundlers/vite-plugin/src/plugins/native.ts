import { transformNative } from '@lit-core/native';
import type { Plugin } from 'vite';
import { reportTransformError } from '../errors.js';
import type { NativeOptions } from '../options.js';
import { matchesPattern } from '../utils.js';

const LIT_NATIVE_FAST_CHECK = /\bclass\b[\s\S]*?\bextends\b|@customElement\b/;

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
      } catch (err) {
        reportTransformError(this, 'native', cleanId, err);
      }
    },
  };
}

export const litNative = native;
