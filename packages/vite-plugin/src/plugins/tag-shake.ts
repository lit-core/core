import { scanTags, transformTagShake } from '@lit-core/tag-shake';
import type { Plugin } from 'vite';
import type { TagShakeOptions } from '../options.js';
import { matchesPattern } from '../utils.js';

const TAG_SHAKE_FAST_CHECK = /\.define\(|customElement\(/;

export function tagShake(options: TagShakeOptions = {}): Plugin {
  const { sourcemap = true, keepTags = [] } = options;
  const usedTags = new Set<string>(keepTags);

  return {
    name: 'tag-shake',
    enforce: 'post',

    buildStart() {
      usedTags.clear();
      for (const t of keepTags) {
        usedTags.add(t);
      }
    },

    transform(code: string, id: string) {
      const cleanId = id.split('?')[0] ?? id;

      // 1. Scan application templates for used custom element tag names
      const isAppFile = !cleanId.includes('/node_modules/');
      if (isAppFile && /\.(?:[jt]sx?|html|vue|svelte|astro)$/.test(cleanId)) {
        try {
          const tags = scanTags(code, cleanId);
          for (const t of tags) {
            usedTags.add(t);
          }
        } catch {}
      }

      // 2. Check if file contains registrations to prune
      if (options.exclude) {
        const excludes = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
        for (const pattern of excludes) {
          if (matchesPattern(cleanId, pattern)) return null;
        }
      }

      if (options.include) {
        const includes = Array.isArray(options.include) ? options.include : [options.include];
        const matched = includes.some((pattern) => matchesPattern(cleanId, pattern));
        if (!matched) return null;
      }

      if (!TAG_SHAKE_FAST_CHECK.test(code)) {
        return null;
      }

      try {
        const result = transformTagShake(code, {
          usedTags: Array.from(usedTags),
          sourcemap,
          filename: cleanId,
        });

        if (result.shakenRegistrationsCount === 0) {
          return null;
        }

        return {
          code: result.code,
          map: result.map ? JSON.parse(result.map) : null,
        };
      } catch {
        return null;
      }
    },

    renderChunk(code: string, chunk) {
      if (!TAG_SHAKE_FAST_CHECK.test(code)) {
        return null;
      }

      try {
        const result = transformTagShake(code, {
          usedTags: Array.from(usedTags),
          sourcemap,
          filename: chunk.fileName,
        });

        if (result.shakenRegistrationsCount === 0) {
          return null;
        }

        return {
          code: result.code,
          map: result.map ? JSON.parse(result.map) : null,
        };
      } catch {
        return null;
      }
    },
  };
}

export const litTagShake = tagShake;
