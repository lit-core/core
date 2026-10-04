import { minifyEmbeddedCss } from '@lit-core/css-minifier';
import { minifyHtmlTemplates } from '@lit-core/html-minifier';
import type { CssMinifierOptions, HtmlMinifierOptions } from '../options.js';
import { shouldProcessFile, type TransformResult } from './common.js';

export const LIT_HTML_FAST_CHECK = /\b(?:html|svg)\s*`/;
export const LIT_CSS_FAST_CHECK = /\bcss\s*`/;

export function transformHtmlMinifier(code: string, id: string, options: HtmlMinifierOptions = {}): TransformResult | null {
  const { sourcemap = false } = options;
  const cleanId = id.split('?')[0] ?? id;

  if (!shouldProcessFile(cleanId, options)) {
    return null;
  }

  if (!LIT_HTML_FAST_CHECK.test(code)) {
    return null;
  }

  try {
    const result = minifyHtmlTemplates(code, {
      sourcemap,
      filename: cleanId,
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

export function transformCssMinifier(code: string, id: string, options: CssMinifierOptions = {}): TransformResult | null {
  const { sourcemap = true } = options;
  const cleanId = id.split('?')[0] ?? id;

  if (!shouldProcessFile(cleanId, options)) {
    return null;
  }

  if (!LIT_CSS_FAST_CHECK.test(code)) {
    return null;
  }

  try {
    const result = minifyEmbeddedCss(code, {
      sourcemap,
      filename: cleanId,
    });

    if (result.minifiedTemplates === 0) {
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
