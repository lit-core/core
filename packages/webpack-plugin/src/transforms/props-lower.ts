import { transformLitProps } from '@lit-core/props-lower';
import type { PropsLowerOptions } from '../options.js';
import { shouldProcessFile, type TransformResult } from './common.js';

export const LIT_DECORATOR_FAST_CHECK = /@(?:customElement|property|state|query|queryAll|queryAsync|queryAssignedElements|queryAssignedNodes|eventOptions|localized)\b|__(?:decorate|decorateClass)\b/;

export function transformPropsLower(code: string, id: string, options: PropsLowerOptions = {}): TransformResult | null {
  const { sourcemap = true } = options;
  const cleanId = id.split('?')[0] ?? id;

  if (!shouldProcessFile(cleanId, options)) {
    return null;
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
}
