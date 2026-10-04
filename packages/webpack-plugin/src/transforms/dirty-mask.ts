import { transformDirtyMask } from '@lit-core/dirty-mask';
import type { DirtyMaskOptions } from '../options.js';
import { shouldProcessFile, type TransformResult } from './common.js';

export const LIT_DIRTY_MASK_FAST_CHECK = /(?:html|svg)\s*`[\s\S]*?\${/;

export function transformDirtyMaskPlugin(code: string, id: string, options: DirtyMaskOptions = {}): TransformResult | null {
  const { sourcemap = true } = options;
  const cleanId = id.split('?')[0] ?? id;

  if (!shouldProcessFile(cleanId, options)) {
    return null;
  }

  if (!LIT_DIRTY_MASK_FAST_CHECK.test(code)) {
    return null;
  }

  try {
    const result = transformDirtyMask(code, {
      sourcemap,
      filename: cleanId,
    });

    if (result.maskedPartsCount === 0) {
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
