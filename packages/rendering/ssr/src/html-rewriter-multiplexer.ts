import { drainPendingBoundariesOutOfOrder } from './async-render.js';
import { createAsyncRenderState } from './async-state.js';
import { isThenable, type SsrAsyncRenderState, type SsrRenderContext } from './compiler-bridge.js';
import { readLiveHostAttributesMap } from './component/host-attributes.js';
import { prepareAndRunComponentLifecycle } from './component/lifecycle.js';
import type { CustomElementLookup } from './environment.js';
import type { HtmlRewriterDocumentEndLike, HtmlRewriterElementLike, HtmlRewriterIslandDefinition, HtmlRewriterSsrOptions } from './html-rewriter-types.js';
import { renderWithPendingBoundaries } from './render-api.js';
import { createSsrRenderContext } from './renderer.js';
import { formatAdoptedUrlFallbackScript, formatCssAdoptScript } from './sdsd-scripts.js';
import { buildShadowStyleAndTemplateOpen } from './shadow-template.js';
import type { SlotManager } from './slot.js';

export function readElementAttributes(el: HtmlRewriterElementLike): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (el.attributes && typeof el.attributes[Symbol.iterator] === 'function') {
    for (const [name, value] of el.attributes) {
      attrs[name] = value;
    }
  }
  return attrs;
}

export function syncElementHostAttributes(
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
  private readonly registry: CustomElementLookup | undefined;

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
