import { transformElemProxy as runTransformElemProxy } from '@lit-core/elem-proxy';
import type { ElemProxyOptions } from '../options.js';
import { shouldProcessFile, type TransformResult } from './common.js';

export const LIT_ELEM_PROXY_FAST_CHECK = /@customElement\b|customElements\.define\b/;

export function transformElemProxy(code: string, id: string, options: ElemProxyOptions = {}): TransformResult | null {
  const { sourcemap = true } = options;
  const cleanId = id.split('?')[0] ?? id;

  if (!shouldProcessFile(cleanId, options)) {
    return null;
  }

  if (!LIT_ELEM_PROXY_FAST_CHECK.test(code)) {
    return null;
  }

  try {
    const result = runTransformElemProxy(code, {
      sourcemap,
      filename: cleanId,
      mode: options.mode,
    });

    if (result.proxiedElementsCount === 0) {
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
