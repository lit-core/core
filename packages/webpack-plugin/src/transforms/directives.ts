import { transformDirectives } from '@lit-core/directives';
import type { DirectivesOptions } from '../options.js';
import { shouldProcessFile, type TransformResult } from './common.js';

export const LIT_DIRECTIVES_FAST_CHECK = /(?:lit|lit-html)\/directives\//;

export function transformDirectivesPlugin(code: string, id: string, options: DirectivesOptions = {}): TransformResult | null {
  const { sourcemap = true } = options;
  const cleanId = id.split('?')[0] ?? id;

  if (!shouldProcessFile(cleanId, options)) {
    return null;
  }

  if (!LIT_DIRECTIVES_FAST_CHECK.test(code)) {
    return null;
  }

  try {
    const result = transformDirectives(code, {
      sourcemap,
      filename: cleanId,
    });

    if (result.loweredCount === 0) {
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
