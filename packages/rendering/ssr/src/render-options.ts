import type { SsrRenderContext } from './compiler-bridge.js';
import type { CustomElementLookup } from './environment.js';

export interface RenderOptions {
  /**
   * Render output mode:
   * - 'dsd' (default): Native Declarative Shadow DOM (<template shadowrootmode="open">).
   * - 'flattened': Flattens shadow roots and slots into semantic light DOM (SEO / crawlers).
   * @default 'dsd'
   */
  mode?: 'dsd' | 'flattened';

  /**
   * Scoped custom element registry to resolve component constructors during render.
   */
  customElements?: CustomElementLookup;

  /**
   * Enable @lit-core/resumable state snapshots (`data-lit-state`)
   * and listener `resumes-on-*` attributes.
   * @default true
   */
  resumable?: boolean;

  /**
   * Enable @lit-core/dom-paths clean DSD mode, emitting zero <!--lit-part--> comments.
   * @default true
   */
  domPaths?: boolean;

  /**
   * Deduplicate CSS styles across component instances within the same render pass.
   * @default true
   */
  cssFuse?: boolean;

  /**
   * Optional server state dictionary injected into the rendering context.
   */
  state?: Record<string, unknown>;

  /**
   * Maximum recursion depth for nested custom elements and subtemplates.
   * @default 100
   */
  depth?: number;

  /**
   * Async streaming mode for deferred promises and async directives:
   * - 'out-of-order' (default): Emits synchronous shell with fallback boundaries immediately,
   *   then streams `<template>` + `<script>$s(...)</script>` tail chunks in completion order (`Promise.race`).
   * - 'in-order': Awaits promises in document order before continuing the HTML stream (zero client swap script).
   * - 'sync': Synchronous single pass; renders fallbacks only without awaiting promises.
   * @default 'out-of-order'
   */
  streamingMode?: 'out-of-order' | 'in-order' | 'sync';

  /**
   * Per-boundary timeout in milliseconds before rejecting with a timeout error.
   * Defaults to 5000ms. Pass 0 or Infinity to disable the deadline.
   * @default 5000
   */
  timeoutMs?: number;

  /**
   * Fallback content or factory rendered into an async boundary when its Promise rejects or times out.
   */
  errorFallback?: unknown | ((error: unknown) => unknown);

  /**
   * Error observer invoked on component lifecycle or async boundary errors.
   */
  onError?: (error: unknown, info: { tagName?: string; phase: string }) => void;

  /**
   * When true, rethrows errors from `connectedCallback()` and `willUpdate()`.
   * @default false
   */
  strictLifecycle?: boolean;

  /**
   * Content-Security-Policy nonce applied to emitted `<script>` and `<style>` tags.
   */
  nonce?: string;

  /**
   * AbortSignal to cancel pending async boundaries when the client disconnects.
   */
  signal?: AbortSignal;

  /**
   * Root W3C Context values (`Map<Context, value>` or plain object) resolved when
   * descendant components dispatch `context-request` events during SSR.
   */
  context?: Map<unknown, unknown> | Record<PropertyKey, unknown>;

  /**
   * Optional constructable stylesheet URL resolver for emitting `shadowrootadoptedstylesheets`
   * on `<template shadowrootmode="open">`, paired with a feature-detected `adoptedStyleSheets` fallback.
   */
  adoptedStyleSheets?: {
    urlResolver?: (sheetKey: string, css: string) => string;
  };

  /**
   * When true, enforces strict AOT execution constraints: uncompiled templates
   * without an AOT SSR plan throw an error instead of invoking on-the-fly plan compilation.
   * @default false
   */
  edge?: boolean;

  /**
   * When true, emits `defer-hydration` on rendered custom elements and `hydrate-internals-*`
   * backup attributes for reflected `ElementInternals` AOM fields.
   * @default false
   */
  deferHydration?: boolean;

  /**
   * Observer callback invoked whenever a registered custom element is server-rendered.
   */
  customElementRendered?: (tagName: string) => void;

  /**
   * Tag names (or predicate) excluded from SSR shadow expansion. Excluded elements render
   * as light-DOM custom element tags without instantiating their constructors.
   */
  excludeElements?: ReadonlySet<string> | readonly string[] | ((tagName: string) => boolean);

  /**
   * Predicate controlling whether `connectedCallback()` is invoked for a rendered custom element.
   * Defaults to `true` for all rendered elements when omitted.
   */
  shouldCallConnectedCallback?: (tagName: string, instance: unknown) => boolean;

  /**
   * Optional server-element pipeline adapter for concurrent `@loader()` execution
   * and HMAC state signing across top-level and nested custom elements.
   */
  serverElementAdapter?: SsrRenderContext['serverElementAdapter'];
}
