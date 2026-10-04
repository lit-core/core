import { transformMemoize } from '@lit-core/memoize';
import type { MemoizeOptions } from '../options.js';
import { shouldProcessFile, type TransformResult } from './common.js';

export const LIT_MEMOIZE_FAST_CHECK = /\brender\s*\([^)]*\)\s*\{/;

export function transformMemoizePlugin(code: string, id: string, options: MemoizeOptions = {}): TransformResult | null {
  const { sourcemap = true } = options;
  const cleanId = id.split('?')[0] ?? id;

  if (!shouldProcessFile(cleanId, options)) {
    return null;
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
}
