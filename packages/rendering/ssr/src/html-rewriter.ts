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

import { isThenable, type SsrAsyncRenderState, type SsrRenderContext } from './compiler-bridge.js';
import type { CustomElementRegistryLike } from './environment.js';
import {
  buildShadowStyleAndTemplateOpen,
  createAsyncRenderState,
  createSsrRenderContext,
  drainPendingBoundariesOutOfOrder,
  formatAdoptedUrlFallbackScript,
  formatCssAdoptScript,
  prepareAndRunComponentLifecycle,
  type RenderOptions,
  readLiveHostAttributesMap,
  renderWithPendingBoundaries,
} from './renderer.js';
import type { SlotManager } from './slot.js';

export interface HtmlRewriterContentOptions {
  html?: boolean;
}

export interface HtmlRewriterEndTagLike {
  name: string;
  before(content: string, options?: HtmlRewriterContentOptions): HtmlRewriterEndTagLike;
  after(content: string, options?: HtmlRewriterContentOptions): HtmlRewriterEndTagLike;
  remove(): HtmlRewriterEndTagLike;
}

export interface HtmlRewriterElementLike {
  tagName: string;
  attributes: Iterable<[string, string]>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): HtmlRewriterElementLike;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): HtmlRewriterElementLike;
  prepend(content: string, options?: HtmlRewriterContentOptions): HtmlRewriterElementLike;
  append(content: string, options?: HtmlRewriterContentOptions): HtmlRewriterElementLike;
  before(content: string, options?: HtmlRewriterContentOptions): HtmlRewriterElementLike;
  after(content: string, options?: HtmlRewriterContentOptions): HtmlRewriterElementLike;
  replace(content: string, options?: HtmlRewriterContentOptions): HtmlRewriterElementLike;
  remove(): HtmlRewriterElementLike;
  onEndTag?(handler: (endTag: HtmlRewriterEndTagLike) => void | Promise<void>): void;
}

export interface HtmlRewriterDocumentEndLike {
  append(content: string, options?: HtmlRewriterContentOptions): HtmlRewriterDocumentEndLike;
}

export interface HtmlRewriterElementHandler {
  element?(element: HtmlRewriterElementLike): void | Promise<void>;
}

export interface HtmlRewriterDocumentHandler {
  end?(end: HtmlRewriterDocumentEndLike): void | Promise<void>;
}

export interface HtmlRewriterLike {
  on(selector: string, handler: HtmlRewriterElementHandler): HtmlRewriterLike;
  onDocument?(handler: HtmlRewriterDocumentHandler): HtmlRewriterLike;
  transform(response: Response): Response;
}

export interface HtmlRewriterIslandDefinition {
  /**
   * Synchronous or asynchronous island render function receiving parsed host attributes.
   * May return a Lit TemplateResult, CompiledTemplateResult, component instance, or string.
   */
  render: (attributes: Record<string, string>) => unknown | Promise<unknown>;

  /**
   * Optional synchronous pending fallback rendered inside `<slot name="pending">...</slot>`
   * while the island's `render()` Promise resolves in the background.
   */
  pending?: string | ((attributes: Record<string, string>) => unknown);

  /**
   * Optional CSS styles emitted inside `<style>` in the island's Declarative Shadow DOM.
   */
  styles?: string | string[];

  /**
   * Optional per-island error fallback if the island's `render()` Promise rejects.
   */
  errorFallback?: (error: unknown) => unknown;
}

export interface HtmlRewriterServerElementAdapter {
  canHandle(Ctor: new () => any, tagName: string): boolean;
  prepareBoundary(input: { instance: any; Ctor: new () => any; tagName: string; hostId: number; incomingAttrs: Record<string, string>; ssrContext: SsrRenderContext }): {
    immediateHostAttributes?: Record<string, string>;
    pendingContent?: unknown;
    boundaryPromise: Promise<unknown>;
  };
}

export interface HtmlRewriterSsrOptions extends RenderOptions {
  /**
   * Build-time tag manifest emitted by the bundler plugin listing all registered
   * custom element tags to intercept in HTMLRewriter.
   */
  tagManifest?: readonly string[] | Set<string>;

  /**
   * Explicit tag names to register with `rewriter.on(tagName, ...)` in addition to
   * any tag names discoverable from `tagManifest` or `islands`.
   */
  tagNames?: string[];

  /**
   * Map of custom element tag names to sync/async island definitions.
   */
  islands?: Record<string, HtmlRewriterIslandDefinition>;

  /**
   * Optional server-element pipeline adapter for concurrent `@loader()` execution
   * and HMAC state signing during HTMLRewriter streaming.
   */
  serverElementAdapter?: HtmlRewriterServerElementAdapter;
}

function readElementAttributes(el: HtmlRewriterElementLike): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (el.attributes && typeof el.attributes[Symbol.iterator] === 'function') {
    for (const [name, value] of el.attributes) {
      attrs[name] = value;
    }
  }
  return attrs;
}

function syncElementHostAttributes(
  el: HtmlRewriterElementLike,
  incomingAttrs: Record<string, string>,
  liveAttrs: Map<string, string>,
  extraAttrs: {
    adoptKeys?: readonly string[];
    adoptedUrls?: readonly string[];
    hostId?: number;
    stateJson?: string;
    domPaths?: boolean;
  },
): void {
  for (const oldName of Object.keys(incomingAttrs)) {
    if (oldName === 'data-lit-ssr') continue;
    if (!liveAttrs.has(oldName.toLowerCase())) {
      el.removeAttribute(oldName);
    }
  }
  for (const [name, val] of liveAttrs.entries()) {
    el.setAttribute(name, val);
  }
  if (extraAttrs.domPaths && !el.hasAttribute('data-lit-paths')) {
    el.setAttribute('data-lit-paths', 'true');
  }
  if (extraAttrs.adoptKeys && extraAttrs.adoptKeys.length > 0) {
    el.setAttribute('data-lit-adopt', extraAttrs.adoptKeys.join(' '));
  }
  if (extraAttrs.adoptedUrls && extraAttrs.adoptedUrls.length > 0) {
    el.setAttribute('data-lit-adopted-urls', extraAttrs.adoptedUrls.join(' '));
  }
  if (extraAttrs.hostId !== undefined) {
    el.setAttribute('data-lit-ssr', String(extraAttrs.hostId));
  }
  if (extraAttrs.stateJson && !el.hasAttribute('data-lit-state')) {
    el.setAttribute('data-lit-state', extraAttrs.stateJson);
  }
}

export class HtmlRewriterSsrMultiplexer {
  readonly options: HtmlRewriterSsrOptions;
  readonly asyncState: SsrAsyncRenderState;
  public hasBody = false;
  public hasHtml = false;
  private readonly ssrContext: SsrRenderContext;
  private readonly maxDepth: number;
  private readonly slotManager: SlotManager;
  private readonly sharedContextState: { context: SsrRenderContext; maxDepth: number; slotManager: SlotManager };
  private readonly registry: CustomElementRegistryLike | undefined;

  constructor(options: HtmlRewriterSsrOptions = {}) {
    this.options = options;
    this.asyncState = createAsyncRenderState();
    const created = createSsrRenderContext(options, this.asyncState);
    this.ssrContext = created.context;
    this.maxDepth = created.maxDepth;
    this.slotManager = created.slotManager;
    this.sharedContextState = created;
    this.registry = options.customElements ?? (globalThis as any).customElements;
  }

  /**
   * Strictly synchronous `HTMLRewriter` element handler (`returns void`, never a `Promise`).
   * Avoids lol-html head-of-line tokenizer blocking while recursively expanding nested
   * Declarative Shadow DOM and dispatching async component promises in parallel.
   */
  public element = (el: HtmlRewriterElementLike): void => {
    const tagName = el.tagName.toLowerCase();
    if (el.hasAttribute('data-lit-ssr')) {
      return;
    }

    const island = this.options.islands?.[tagName];
    const Ctor = this.registry?.get(tagName);
    if (!island && !Ctor) {
      return;
    }

    const attrs = readElementAttributes(el);

    if (island) {
      this.handleIslandElement(el, tagName, attrs, island);
      return;
    }

    if (Ctor) {
      this.handleCustomElementCtor(el, tagName, attrs, Ctor);
    }
  };

  private renderFragmentInSharedContext(value: unknown): string {
    return renderWithPendingBoundaries(value, this.options, this.asyncState, this.sharedContextState).html;
  }

  private handleIslandElement(el: HtmlRewriterElementLike, tagName: string, attrs: Record<string, string>, island: HtmlRewriterIslandDefinition): void {
    const hostId = this.asyncState.nextHostId++;

    let styleTag = '';
    if (island.styles) {
      const css = Array.isArray(island.styles) ? island.styles.join('\n') : island.styles;
      if (css.trim()) {
        styleTag = `<style>${css.trim()}</style>`;
      }
    }

    let renderedOrPromise: unknown;
    try {
      renderedOrPromise = island.render(attrs);
    } catch (err) {
      this.options.onError?.(err, { tagName, phase: 'island.render' });
      return;
    }

    if (isThenable(renderedOrPromise)) {
      const promise = Promise.resolve(renderedOrPromise);
      promise.catch(() => {});
      const boundaryId = this.asyncState.nextBoundaryId++;
      this.asyncState.boundaries.push({
        id: boundaryId,
        shadowPath: [hostId],
        promise,
        errorFallback: island.errorFallback,
      });

      let pendingHtml = '';
      if (island.pending !== undefined) {
        const pendingVal = typeof island.pending === 'function' ? island.pending(attrs) : island.pending;
        if (typeof pendingVal === 'string') {
          pendingHtml = pendingVal;
        } else {
          this.asyncState.shadowPath.push(hostId);
          try {
            pendingHtml = this.renderFragmentInSharedContext(pendingVal);
          } finally {
            this.asyncState.shadowPath.pop();
          }
        }
      }

      el.setAttribute('data-lit-ssr', String(hostId));
      const shadowHtml = `<template shadowrootmode="open">${styleTag}<!--$b:${boundaryId}--><slot name="pending">${pendingHtml}</slot><!--/$b:${boundaryId}--></template>`;
      el.prepend(shadowHtml, { html: true });
      return;
    }

    this.asyncState.shadowPath.push(hostId);
    let innerShadowHtml = '';
    try {
      innerShadowHtml = this.renderFragmentInSharedContext(renderedOrPromise);
    } finally {
      this.asyncState.shadowPath.pop();
    }

    el.setAttribute('data-lit-ssr', String(hostId));
    el.prepend(`<template shadowrootmode="open">${styleTag}${innerShadowHtml}</template>`, { html: true });
  }

  private handleCustomElementCtor(el: HtmlRewriterElementLike, tagName: string, attrs: Record<string, string>, Ctor: new () => any): void {
    const instance = new Ctor();
    const hostId = this.asyncState.nextHostId++;

    const adapter = this.options.serverElementAdapter;
    if (adapter?.canHandle(Ctor, tagName)) {
      const { templateOpenTag, styleTag, adoptKeys, adoptedUrls } = buildShadowStyleAndTemplateOpen(Ctor, this.ssrContext);
      const prepared = adapter.prepareBoundary({
        instance,
        Ctor,
        tagName,
        hostId,
        incomingAttrs: attrs,
        ssrContext: this.ssrContext,
      });

      prepared.boundaryPromise.catch(() => {});
      const boundaryId = this.asyncState.nextBoundaryId++;
      this.asyncState.boundaries.push({
        id: boundaryId,
        shadowPath: [hostId],
        promise: prepared.boundaryPromise,
      });

      let pendingHtml = '';
      if (prepared.pendingContent !== undefined) {
        this.asyncState.shadowPath.push(hostId);
        try {
          pendingHtml = this.renderFragmentInSharedContext(prepared.pendingContent);
        } finally {
          this.asyncState.shadowPath.pop();
        }
      }

      if (prepared.immediateHostAttributes) {
        for (const [k, v] of Object.entries(prepared.immediateHostAttributes)) {
          el.setAttribute(k, v);
        }
      }
      if (adoptKeys.length > 0) {
        el.setAttribute('data-lit-adopt', adoptKeys.join(' '));
      }
      if (adoptedUrls.length > 0) {
        el.setAttribute('data-lit-adopted-urls', adoptedUrls.join(' '));
      }
      el.setAttribute('data-lit-ssr', String(hostId));

      const shadowHtml = `${templateOpenTag}${styleTag}<!--$b:${boundaryId}--><slot name="pending">${pendingHtml}</slot><!--/$b:${boundaryId}--></template>`;
      el.prepend(shadowHtml, { html: true });
      return;
    }

    prepareAndRunComponentLifecycle({
      instance,
      Ctor,
      tagName,
      staticAttrs: attrs,
      contextLookup: this.ssrContext.contextLookup,
      onError: this.options.onError,
      strictLifecycle: this.options.strictLifecycle,
      resumable: this.ssrContext.resumable,
    });

    const { templateOpenTag, styleTag, adoptKeys, adoptedUrls } = buildShadowStyleAndTemplateOpen(Ctor, this.ssrContext);
    const liveAttrs = readLiveHostAttributesMap(instance);
    const stateJson = this.ssrContext.resumable ? this.ssrContext.compilerBridge.serializeComponentState(instance, this.ssrContext) : '';

    syncElementHostAttributes(el, attrs, liveAttrs, {
      adoptKeys,
      adoptedUrls,
      hostId,
      stateJson,
      domPaths: this.ssrContext.domPaths,
    });

    const rawShadowResult = typeof instance.renderAsync === 'function' ? instance.renderAsync() : instance.render?.();

    if (isThenable(rawShadowResult)) {
      const promise = Promise.resolve(rawShadowResult);
      promise.catch(() => {});
      const boundaryId = this.asyncState.nextBoundaryId++;
      this.asyncState.boundaries.push({
        id: boundaryId,
        shadowPath: [hostId],
        promise,
      });

      let pendingHtml = '';
      if (typeof instance.renderPending === 'function') {
        this.asyncState.shadowPath.push(hostId);
        try {
          pendingHtml = this.renderFragmentInSharedContext(instance.renderPending());
        } finally {
          this.asyncState.shadowPath.pop();
        }
      }

      const shadowHtml = `${templateOpenTag}${styleTag}<!--$b:${boundaryId}--><slot name="pending">${pendingHtml}</slot><!--/$b:${boundaryId}--></template>`;
      el.prepend(shadowHtml, { html: true });
      return;
    }

    const incrementLitShadow = Boolean((Ctor as any)?._$litElement$);
    if (incrementLitShadow) {
      this.ssrContext.litShadowDepth = (this.ssrContext.litShadowDepth ?? 0) + 1;
    }
    this.asyncState.shadowPath.push(hostId);
    let innerShadowHtml = '';
    try {
      if (rawShadowResult !== undefined && rawShadowResult !== null) {
        innerShadowHtml = this.renderFragmentInSharedContext(rawShadowResult);
      }
    } finally {
      this.asyncState.shadowPath.pop();
      if (incrementLitShadow) {
        this.ssrContext.litShadowDepth = Math.max(0, (this.ssrContext.litShadowDepth ?? 1) - 1);
      }
    }

    el.prepend(`${templateOpenTag}${styleTag}${innerShadowHtml}</template>`, { html: true });
  }

  /**
   * Strictly synchronous body handler: removes </body> so HTMLRewriter never buffers
   * or pauses tokenizer streaming at the end of the body.
   */
  public bodyElement = (el: HtmlRewriterElementLike): void => {
    this.hasBody = true;
    if (typeof el.onEndTag === 'function') {
      el.onEndTag((endTag) => {
        endTag.remove();
      });
    }
  };

  /**
   * Strictly synchronous html handler: removes </html> so trailing boundary chunks
   * can be emitted dynamically before closing tags are written by the outer stream.
   */
  public htmlElement = (el: HtmlRewriterElementLike): void => {
    this.hasHtml = true;
    if (typeof el.onEndTag === 'function') {
      el.onEndTag((endTag) => {
        endTag.remove();
      });
    }
  };

  /**
   * Document end fallback hook for HTML fragments that do not contain a <body> tag.
   */
  public documentEnd = async (_end: HtmlRewriterDocumentEndLike): Promise<void> => {
    // Outer progressive stream handles tail chunk emission
  };

  public async *drainPendingChunks(): AsyncIterableIterator<string> {
    if (this.asyncState.boundaries.length === 0) {
      if (this.ssrContext.mode === 'dsd') {
        const urlEntries = this.ssrContext.styleDeduplicator.flushAdoptedUrlSheets();
        if (urlEntries.length > 0) {
          yield formatAdoptedUrlFallbackScript(urlEntries, this.ssrContext.nonce);
        }
        const adoptState = this.ssrContext.styleDeduplicator.consumePendingInlineAdoption();
        if (adoptState.needsCall) {
          yield formatCssAdoptScript(adoptState.needsBootstrap, this.ssrContext.nonce);
        }
      }
      return;
    }
    yield* drainPendingBoundariesOutOfOrder(this.asyncState, this.ssrContext, this.maxDepth, this.slotManager, this.options);
  }
}

/**
 * Wraps the HTMLRewriter transformed stream in an outer ReadableStream that:
 * 1. Passes through the initial rewritten HTML shell with zero latency.
 * 2. Emits out-of-order DSD boundary chunks as each promise settles.
 * 3. Appends </body> and </html> closing tags if stripped.
 */
export function createProgressiveDsdStream(rewrittenBody: ReadableStream<Uint8Array>, multiplexer: HtmlRewriterSsrMultiplexer): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let drainIterator: AsyncIterableIterator<string> | null = null;
  let rewriterDone = false;
  let boundariesDone = false;

  return new ReadableStream<Uint8Array>({
    async start() {
      reader = rewrittenBody.getReader();
    },

    async pull(controller) {
      try {
        if (!rewriterDone) {
          const { done, value } = await reader!.read();
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
          const next = await drainIterator!.next();
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
        await reader?.cancel(reason);
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

export function transformWithHtmlRewriter(input: Response | string, options: HtmlRewriterSsrOptions = {}, rewriterFactory?: () => HtmlRewriterLike): Response {
  const response = typeof input === 'string' ? new Response(input, { headers: { 'content-type': 'text/html; charset=utf-8' } }) : input;

  const RewriterCtor = (globalThis as any).HTMLRewriter as (new () => HtmlRewriterLike) | undefined;
  if (!rewriterFactory && !RewriterCtor) {
    throw new Error('[@lit-core/ssr] HTMLRewriter is not available in the current runtime environment. Execution requires Cloudflare Workers or an explicit rewriterFactory.');
  }
  const rewriter: HtmlRewriterLike = rewriterFactory ? rewriterFactory() : new RewriterCtor!();

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
