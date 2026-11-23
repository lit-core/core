import { type RenderOptions, renderToString } from '@lit-core/ssr';
import type { EdgeResponseOptions } from '../types.js';
import { renderServerElement } from './element.js';
import { isBrandedRenderResult } from './render-result.js';

/** Renders a Lit template result, or any value Lit can render, to an HTML string. Untrusted strings are escaped by `@lit-core/ssr`. */
export function renderTemplateToString(value: unknown, options?: RenderOptions): string {
  return value === null || value === undefined ? '' : renderToString(value, { resumable: false, ...options });
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value) && typeof (value as { then?: unknown }).then === 'function';
}

/**
 * Resolves what `renderToResponse` was given to the HTML it should send:
 * branded render results and strings are sent as they are, constructors are rendered as server
 * elements, and anything else is rendered as a Lit template (and so escaped).
 */
async function resolveHtml(value: unknown, options: EdgeResponseOptions): Promise<string> {
  const resolved = isThenable(value) ? await value : value;
  if (isBrandedRenderResult(resolved)) return resolved.html;
  if (typeof resolved === 'string') return resolved;
  if (typeof resolved === 'function') return (await renderServerElement(resolved as never, {}, options)).html;
  return renderTemplateToString(resolved, { customElements: options.customElements });
}

/** Converts a server element, render result, template, or stream into a standard streaming HTTP Response. */
export function renderToResponse(value: unknown, options: EdgeResponseOptions = {}): Response {
  const headers = new Headers(options.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'text/html; charset=utf-8');
  if (!headers.has('x-content-type-options')) headers.set('x-content-type-options', 'nosniff');
  const init = { status: options.status ?? 200, statusText: options.statusText, headers };

  if (value instanceof ReadableStream) {
    return new Response(value, init);
  }

  const encoder = new TextEncoder();
  const signal = options.request?.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const abortError = () => signal?.reason ?? new Error('Request aborted');
      if (signal?.aborted) {
        controller.error(abortError());
        return;
      }

      let aborted = false;
      const onAbort = () => {
        aborted = true;
        try {
          controller.error(abortError());
        } catch {}
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        const html = await resolveHtml(value, options);
        if (aborted || signal?.aborted) return;
        controller.enqueue(encoder.encode(html));
        controller.close();
      } catch (err) {
        if (!aborted && !signal?.aborted) controller.error(err);
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    },
  });

  return new Response(stream, init);
}
