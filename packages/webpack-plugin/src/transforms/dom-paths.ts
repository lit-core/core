import { transformDomPaths } from '@lit-core/dom-paths';
import type { DomPathsOptions } from '../options.js';
import { shouldProcessFile, type TransformResult } from './common.js';

export const LIT_DOM_PATHS_FAST_CHECK = /(?:html|svg)\s*`[\s\S]*?\${/;

export function transformDomPathsPlugin(code: string, id: string, options: DomPathsOptions = {}): TransformResult | null {
  const { sourcemap = true } = options;
  const cleanId = id.split('?')[0] ?? id;

  if (!shouldProcessFile(cleanId, options)) {
    return null;
  }

  if (!LIT_DOM_PATHS_FAST_CHECK.test(code)) {
    return null;
  }

  try {
    const result = transformDomPaths(code, {
      sourcemap,
      filename: cleanId,
      normalizeWhitespace: options.normalizeWhitespace,
    });

    if (result.componentsCount === 0 || result.pathsCount === 0) {
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
