import type { ServerElementRenderResult } from '../types.js';

const RENDER_RESULT_BRAND = Symbol('lit-core.server-elements.render-result');

/**
 * Marks a render result as trusted markup produced by `renderServerElement`.
 *
 * `renderToResponse` emits branded results verbatim and escapes everything else, so an object an
 * attacker shaped like a result (with an `html` field) can never inject raw markup.
 */
export function brandRenderResult(result: ServerElementRenderResult): ServerElementRenderResult {
  Object.defineProperty(result, RENDER_RESULT_BRAND, { value: true, enumerable: false });
  return result;
}

export function isBrandedRenderResult(value: unknown): value is ServerElementRenderResult {
  return value !== null && typeof value === 'object' && (value as Record<symbol, unknown>)[RENDER_RESULT_BRAND] === true && typeof (value as { html?: unknown }).html === 'string';
}
