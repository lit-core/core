import { transformLitProps } from '@lit-core/props-lower';
import type { Plugin } from 'vite';
import type { PropsLowerOptions } from '../options.js';
import { matchesPattern } from '../utils.js';

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

export const litPropsLower = propsLower;
