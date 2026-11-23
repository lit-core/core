import type { SsrRenderContext } from './compiler-bridge.js';
import type { RenderOptions } from './render-options.js';

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
