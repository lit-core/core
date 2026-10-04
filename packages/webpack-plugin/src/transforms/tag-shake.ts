import { scanTags, transformTagShake } from '@lit-core/tag-shake';
import type { TagShakeOptions } from '../options.js';
import { matchesPattern } from '../utils.js';
import type { TransformResult } from './common.js';

export const TAG_SHAKE_FAST_CHECK = /\.define\(|customElement\(/;

export function scanAppTags(code: string, id: string, targetSet: Set<string>): void {
  const cleanId = id.split('?')[0] ?? id;
  if (!cleanId.includes('/node_modules/') && /\.(?:[jt]sx?|html|vue|svelte|astro)$/.test(cleanId)) {
    try {
      const tags = scanTags(code, cleanId);
      for (const t of tags) {
        targetSet.add(t);
      }
    } catch {}
  }
}

export function transformTagShakePlugin(code: string, id: string, options: TagShakeOptions = {}, sharedUsedTags: Set<string>): TransformResult | null {
  const { sourcemap = true } = options;
  const cleanId = id.split('?')[0] ?? id;

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
      usedTags: Array.from(sharedUsedTags),
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
  } catch (_err) {
    return null;
  }
}
