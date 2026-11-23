/**
 * Speculative out-of-order Cloudflare HTMLRewriter (lol-html) multiplexer for @lit-core/ssr.
 *
 * Solves the two architectural walls in Cloudflare's Rust lol-html engine:
 * 1. Head-of-line async waterfall in `element(el)`:
 *    Returning a Promise from `element(el)` pauses the lol-html tokenizer at that byte until the
 *    Promise settles. `HtmlRewriterSsrMultiplexer.element(el)` is strictly synchronous (`void`),
 *    dispatching async component work in parallel in the background while immediately prepending a
 *    Declarative Shadow DOM `<slot name="pending">` boundary so lol-html continues streaming at full speed.
 * 2. Non-recursive `el.prepend(shadowHtml, { html: true })`:
 *    lol-html never re-parses strings injected via `el.prepend(..., { html: true })`. Our single-pass
 *    renderer recursively expands nested custom elements inside shadow templates before calling `el.prepend()`.
 * 3. Out-of-order DSD completion before `</body>`:
 *    In `body`'s `onEndTag` (or stream tail for fragments without `<body>`), parallel promises are
 *    drained fastest-first via `Promise.race`, emitting compact `<template>` + `$s(...)` patches.
 */

import { HtmlRewriterSsrMultiplexer } from './html-rewriter-multiplexer.js';
import type { HtmlRewriterLike, HtmlRewriterSsrOptions } from './html-rewriter-types.js';

export * from './html-rewriter-multiplexer.js';
export * from './html-rewriter-types.js';

/**
 * Wraps the HTMLRewriter transformed stream in an outer ReadableStream that:
 * 1. Passes through the initial rewritten HTML shell with zero latency.
 * 2. Emits out-of-order DSD boundary chunks as each promise settles.
 * 3. Appends </body> and </html> closing tags if stripped.
 */
export function createProgressiveDsdStream(rewrittenBody: ReadableStream<Uint8Array>, multiplexer: HtmlRewriterSsrMultiplexer): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const reader = rewrittenBody.getReader();
  let drainIterator: AsyncIterableIterator<string> | null = null;
  let rewriterDone = false;
  let boundariesDone = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!rewriterDone) {
          const { done, value } = await reader.read();
          if (!done) {
            if (value && value.byteLength > 0) {
              controller.enqueue(value);
            }
            return;
          }
          rewriterDone = true;
          drainIterator = multiplexer.drainPendingChunks();
        }

        if (!boundariesDone) {
          drainIterator ??= multiplexer.drainPendingChunks();
          const next = await drainIterator.next();
          if (!next.done) {
            if (next.value != null && next.value.length > 0) {
              controller.enqueue(encoder.encode(next.value));
            }
            return;
          }
          boundariesDone = true;
        }

        let closingTags = '';
        if (multiplexer.hasBody) {
          closingTags += '</body>';
        }
        if (multiplexer.hasHtml) {
          closingTags += '</html>';
        }
        if (closingTags.length > 0) {
          controller.enqueue(encoder.encode(closingTags));
        }

        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },

    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } catch {}
      try {
        await drainIterator?.return?.();
      } catch {}
    },
  });
}

export function attachSsrToHtmlRewriter<T extends HtmlRewriterLike>(rewriter: T, options: HtmlRewriterSsrOptions = {}): { rewriter: T; multiplexer: HtmlRewriterSsrMultiplexer } {
  const multiplexer = new HtmlRewriterSsrMultiplexer(options);
  const selectors = new Set<string>();

  if (options.tagManifest) {
    for (const tag of options.tagManifest) {
      selectors.add(tag.toLowerCase());
    }
  }
  if (options.tagNames) {
    for (const tag of options.tagNames) {
      selectors.add(tag.toLowerCase());
    }
  }
  if (options.islands) {
    for (const tag of Object.keys(options.islands)) {
      selectors.add(tag.toLowerCase());
    }
  }
  if (typeof options.customElements?.getRegisteredTagNames === 'function') {
    for (const tag of options.customElements.getRegisteredTagNames()) {
      selectors.add(tag.toLowerCase());
    }
  }

  if (selectors.size === 0) {
    throw new Error('[@lit-core/ssr] No tag manifest provided to HTMLRewriter. Provide tagManifest, tagNames, or islands to avoid intercepting all elements (*).');
  }

  for (const selector of selectors) {
    rewriter.on(selector, { element: multiplexer.element });
  }

  rewriter.on('body', { element: multiplexer.bodyElement });
  rewriter.on('html', { element: multiplexer.htmlElement });

  return { rewriter, multiplexer };
}

/** The runtime's own `HTMLRewriter` (Cloudflare Workers), for callers that did not supply a factory. */
function createRuntimeHtmlRewriter(): HtmlRewriterLike {
  const RewriterCtor = (globalThis as any).HTMLRewriter as (new () => HtmlRewriterLike) | undefined;
  if (!RewriterCtor) {
    throw new Error('[@lit-core/ssr] HTMLRewriter is not available in the current runtime environment. Execution requires Cloudflare Workers or an explicit rewriterFactory.');
  }
  return new RewriterCtor();
}

export function transformWithHtmlRewriter(input: Response | string, options: HtmlRewriterSsrOptions = {}, rewriterFactory?: () => HtmlRewriterLike): Response {
  const response = typeof input === 'string' ? new Response(input, { headers: { 'content-type': 'text/html; charset=utf-8' } }) : input;

  const rewriter: HtmlRewriterLike = rewriterFactory ? rewriterFactory() : createRuntimeHtmlRewriter();

  const { multiplexer } = attachSsrToHtmlRewriter(rewriter, options);
  const transformed = rewriter.transform(response);

  if (!transformed.body) {
    return transformed;
  }

  const progressiveStream = createProgressiveDsdStream(transformed.body, multiplexer);
  return new Response(progressiveStream, {
    status: transformed.status,
    statusText: transformed.statusText,
    headers: new Headers(transformed.headers),
  });
}
