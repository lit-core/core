import { compileHtmlAot } from '@lit-core/html-aot';
import type { HtmlAotOptions } from '../options.js';
import { shouldProcessFile, type TransformResult } from './common.js';
import { LIT_HTML_FAST_CHECK } from './minifiers.js';

export function transformHtmlAot(code: string, id: string, options: HtmlAotOptions = {}): TransformResult | null {
  const { sourcemap = false } = options;
  const cleanId = id.split('?')[0] ?? id;

  if (!shouldProcessFile(cleanId, options)) {
    return null;
  }

  if (!LIT_HTML_FAST_CHECK.test(code)) {
    return null;
  }

  try {
    const result = compileHtmlAot(code, {
      filename: cleanId,
      sourcemap,
    });

    if (result.templatesCount === 0) {
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
