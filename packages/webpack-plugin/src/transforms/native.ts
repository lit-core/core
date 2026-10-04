import { transformNative } from '@lit-core/native';
import type { NativeOptions } from '../options.js';
import { shouldProcessFile, type TransformResult } from './common.js';

export const LIT_NATIVE_FAST_CHECK = /\bLitElement\b|@customElement\b|extends\s+(?:LitElement|ReactiveElement)\b/;

export function transformNativePlugin(code: string, id: string, options: NativeOptions = {}): TransformResult | null {
  const { sourcemap = true } = options;
  const cleanId = id.split('?')[0] ?? id;

  if (!shouldProcessFile(cleanId, options)) {
    return null;
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
  } catch (_err) {
    return null;
  }
}
