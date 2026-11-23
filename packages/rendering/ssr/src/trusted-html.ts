import { isNothing } from './sentinels.js';

export const RAW_HTML_BRAND = Symbol('lit-core.ssr.trusted-raw-html');

export interface TrustedRawHtml {
  readonly [RAW_HTML_BRAND]: true;
  readonly html: string;
}

/**
 * Creates markup the renderer will emit unescaped.
 *
 * The brand is non-enumerable so spreading or `Object.assign`-ing a trusted value yields an
 * ordinary object, which is escaped. Trust never propagates by copying.
 */
export function createTrustedRawHtml(html: string): TrustedRawHtml {
  const trusted = { html };
  Object.defineProperty(trusted, RAW_HTML_BRAND, { value: true, enumerable: false });
  return Object.freeze(trusted) as TrustedRawHtml;
}

export function isTrustedRawHtml(value: unknown): value is TrustedRawHtml {
  return value !== null && typeof value === 'object' && (value as any)[RAW_HTML_BRAND] === true && typeof (value as any).html === 'string';
}

export function unsafeHTML(value: unknown): TrustedRawHtml {
  return createTrustedRawHtml(value == null || isNothing(value) ? '' : String(value));
}

export function unsafeSVG(value: unknown): TrustedRawHtml {
  return createTrustedRawHtml(value == null || isNothing(value) ? '' : String(value));
}

export function unsafeMathML(value: unknown): TrustedRawHtml {
  return createTrustedRawHtml(value == null || isNothing(value) ? '' : String(value));
}

export function unsafeCSS(value: unknown): { readonly cssText: string; toString(): string } {
  const cssText = value == null ? '' : String(value);
  return Object.freeze({
    cssText,
    toString() {
      return cssText;
    },
  });
}
