import { transformResumableComponent } from '@lit-core/resumable';
import type { ResumableOptions } from '../options.js';
import { shouldProcessFile, type TransformResult } from './common.js';
import { LIT_ELEM_PROXY_FAST_CHECK } from './elem-proxy.js';

export function transformResumable(code: string, id: string, options: ResumableOptions = {}): TransformResult | null {
  const cleanId = id.split('?')[0] ?? id;
  if (!shouldProcessFile(cleanId, options)) {
    return null;
  }

  if (!LIT_ELEM_PROXY_FAST_CHECK.test(code)) {
    return null;
  }

  if (options.injectAdapter !== false) {
    try {
      const result = transformResumableComponent(code, {
        filename: cleanId,
        virtualModule: 'virtual:lit-core/resumable-adapter',
      });
      if (result.transformed) {
        return {
          code: result.code,
          map: result.map ? JSON.parse(result.map) : null,
        };
      }
    } catch (_err) {
      return null;
    }
  }

  return null;
}
