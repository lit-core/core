/**
 * Clean Declarative Shadow DOM renderer for @lit-core/ssr.
 * Emits native <template shadowrootmode="open"> with 100% zero <!--lit-part--> comments.
 */

import { compileHtmlDocumentPlan, compileLitDescriptorPlan, compileTemplatePlan } from './compiler.js';
import {
  CompilerBridge,
  escapeAttribute,
  escapeHtml,
  isAsyncBoundaryDescriptor,
  isBoundaryPayload,
  isCompiledTemplateResult,
  isNothing,
  isStandardTemplateResult,
  isThenable,
  isTrustedRawHtml,
  resolveDirectiveValue,
  type SsrAsyncRenderState,
  type SsrDynamicAttribute,
  type SsrOpcode,
  type SsrPendingBoundaryEntry,
  type SsrRenderContext,
  type SsrTemplatePlanV2,
} from './compiler-bridge.js';
import {
  ARIA_MIXIN_ENTRIES,
  CSSStyleSheetStub,
  type CustomElementRegistryLike,
  HTMLElementStub,
  HYDRATE_INTERNALS_ATTR_PREFIX,
  IsolateCustomElementRegistry,
  ShadowRootStub,
  ValidityStateStub,
} from './environment.js';
import { reflectedAttributeName } from './reflected-attributes.js';
import { distributeHostChildren, findMatchingCloseTag, SlotManager } from './slot.js';

export const DEFAULT_BOUNDARY_TIMEOUT_MS = 5000;

/**
 * Standards-based inline swap helper for out-of-order Streaming Declarative Shadow DOM (SDSD).
 * Traverses nested shadow roots via `[data-lit-ssr="id"]`, optionally applies resolved host attributes,
 * and replaces `<!--$b:id-->...<!--/$b:id-->` comment range boundaries with the resolved `<template id="cN">`
 * content fragment, removing both comment markers and the temporary `<template>` element upon completion.
 */
export const SDSD_SWAP_SCRIPT =
  'var $s=(p,b,c,d=document,r=d,t=d.getElementById(c))=>{p.map(i=>r=r.querySelector(`[data-lit-ssr="${i}"]`).shadowRoot);p=d.createTreeWalker(r,128);while(c=p.nextNode())if(c.data=="$b:"+b){while((d=c.nextSibling)&&(d.remove(),d.data!="/$b:"+b));c.replaceWith(...(t.content||t).childNodes)}t.remove()}';

/**
 * Request-scoped shared `CSSStyleSheet` adoption helper for deduplicated constructable stylesheets.
 * Preserves cascade order `[sharedSheets, localOverrides]` across Chromium, Firefox, and Safari.
 */
export const CSS_ADOPT_SCRIPT =
  '$c=(r=document,m=window.__litCS||={})=>{for(const e of r.querySelectorAll("*")){const s=e.shadowRoot;if(s){for(const t of s.querySelectorAll("style[data-lit-sheet]")){const k=t.dataset.litSheet;if(k&&!m[k]){const c=new CSSStyleSheet();c.replaceSync(t.textContent||"");m[k]=c}}const a=e.dataset.litAdopt;if(a){delete e.dataset.litAdopt;const l=s.querySelector("style[data-lit-local]"),p=a.split(" ").map(k=>m[k]).filter(Boolean);if(l){const c=new CSSStyleSheet();c.replaceSync(l.textContent||"");l.remove();p.push(c)}if(p.length)s.adoptedStyleSheets=[...p,...s.adoptedStyleSheets]}$c(s,m)}}}';

export function formatSdsdBootstrapScript(nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${escapeAttribute(nonce)}"` : '';
  return `<script${nonceAttr}>${SDSD_SWAP_SCRIPT}</script>`;
}

export function formatCssAdoptScript(includeBootstrap: boolean, nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${escapeAttribute(nonce)}"` : '';
  return includeBootstrap ? `<script${nonceAttr}>${CSS_ADOPT_SCRIPT};$c()</script>` : `<script${nonceAttr}>$c()</script>`;
}

export function formatAdoptedUrlFallbackScript(entries: ReadonlyArray<{ url: string; css: string }>, nonce?: string): string {
  if (entries.length === 0) return '';
  const nonceAttr = nonce ? ` nonce="${escapeAttribute(nonce)}"` : '';
  const payload = JSON.stringify(Object.fromEntries(entries.map((e) => [e.url, e.css]))).replace(/</g, '\\u003c');
  return `<script${nonceAttr}>if(!("shadowRootAdoptedStyleSheets"in HTMLTemplateElement.prototype)){const u=${payload},m=window.__litUS||={};for(const[k,v]of Object.entries(u))if(!m[k]){const c=new CSSStyleSheet();c.replaceSync(v);m[k]=c}const w=r=>{for(const e of r.querySelectorAll("*")){const s=e.shadowRoot;if(s){const a=e.dataset.litAdoptedUrls;if(a){delete e.dataset.litAdoptedUrls;const l=s.querySelector("style[data-lit-local]"),p=a.split(" ").map(k=>m[k]).filter(Boolean);if(l){const c=new CSSStyleSheet();c.replaceSync(l.textContent||"");l.remove();p.push(c)}if(p.length)s.adoptedStyleSheets=[...p,...s.adoptedStyleSheets]}w(s)}}};w(document)}</script>`;
}

export function formatSdsdTailChunk(
  chunkId: string,
  shadowPath: readonly number[],
  boundaryId: number,
  htmlContent: string,
  nonce?: string,
  isSvg?: boolean,
  hostAttributes?: Record<string, string | null>,
): string {
  const nonceAttr = nonce ? ` nonce="${escapeAttribute(nonce)}"` : '';
  const pathJson = `[${shadowPath.join(',')}]`;
  const tag = isSvg ? 'svg' : 'template';
  let hostPatch = '';
  if (hostAttributes && Object.keys(hostAttributes).length > 0 && shadowPath.length > 0) {
    const attrsJson = JSON.stringify(hostAttributes).replace(/</g, '\\u003c');
    hostPatch = `;(()=>{let r=document,h;for(const i of ${pathJson})h=r.querySelector(\`[data-lit-ssr="\${i}"]\`),r=h.shadowRoot;if(h){for(const[k,v]of Object.entries(${attrsJson}))v==null?h.removeAttribute(k):h.setAttribute(k,v);h.__litRebind?.()}})()`;
  }
  return `<${tag} id="${escapeAttribute(chunkId)}">${htmlContent}</${tag}><script${nonceAttr}>$s(${pathJson},${boundaryId},${JSON.stringify(chunkId)})${hostPatch}</script>`;
}

export function createAsyncRenderState(): SsrAsyncRenderState {
  return {
    nextHostId: 0,
    nextBoundaryId: 0,
    nextChunkId: 0,
    shadowPath: [],
    boundaries: [],
    bootstrapEmitted: false,
  };
}

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
  customElements?: CustomElementRegistryLike;

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

const VALID_TAG_NAME_RE = /^[a-z][a-z0-9._-]*$/;
const VALID_ATTR_NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/;
const validTagCache = new Set<string>();
const validAttrCache = new Set<string>();
const NOOP_RENDER_FN = () => {};
const EMPTY_EVENT_ATTRS: string[] = [];
const EMPTY_ADOPTED_URLS: string[] = [];

const templatePlanCache = new WeakMap<TemplateStringsArray, SsrTemplatePlanV2>();
const descriptorPlanCache = new WeakMap<object, SsrTemplatePlanV2>();

function isValidTagName(name: string): boolean {
  if (validTagCache.has(name)) return true;
  if (VALID_TAG_NAME_RE.test(name)) {
    validTagCache.add(name);
    return true;
  }
  return false;
}

function isValidAttrName(name: string): boolean {
  if (validAttrCache.has(name)) return true;
  if (VALID_ATTR_NAME_RE.test(name)) {
    validAttrCache.add(name);
    return true;
  }
  return false;
}

function isElementInstance(value: unknown): value is HTMLElementStub {
  if (value === null || typeof value !== 'object') return false;
  if (value instanceof HTMLElementStub) return true;
  const gHtmlElement = (globalThis as any).HTMLElement;
  if (typeof gHtmlElement === 'function' && value instanceof gHtmlElement) return true;
  return false;
}

function createContextLookup(contextOption?: Map<unknown, unknown> | Record<PropertyKey, unknown>): ((key: unknown) => { found: boolean; value: unknown }) | undefined {
  if (!contextOption) return undefined;
  if (contextOption instanceof Map) {
    return (key: unknown) => {
      if (contextOption.has(key)) {
        return { found: true, value: contextOption.get(key) };
      }
      return { found: false, value: undefined };
    };
  }
  return (key: unknown) => {
    if ((typeof key === 'string' || typeof key === 'symbol' || typeof key === 'number') && Object.hasOwn(contextOption, key)) {
      return { found: true, value: (contextOption as Record<PropertyKey, unknown>)[key] };
    }
    return { found: false, value: undefined };
  };
}

function isElementExcluded(tagName: string, exclude?: RenderOptions['excludeElements']): boolean {
  if (!exclude) return false;
  if (typeof exclude === 'function') return exclude(tagName);
  if (exclude instanceof Set) return exclude.has(tagName);
  if (Array.isArray(exclude)) return exclude.includes(tagName);
  return false;
}

function componentHasShadowRoot(instance: any, Ctor: any): boolean {
  if (instance?.renderRoot === instance) {
    return false;
  }
  return Boolean(typeof instance?.render === 'function' || instance?.shadowRoot || instance?.__shadowRoot || Ctor?._$litElement$ || Ctor?.styles || Ctor?.elementStyles);
}

const SHARED_DSD_SLOT_MANAGER = new SlotManager();
const SHARED_STATELESS_COMPILER_BRIDGE = new CompilerBridge();

export function createSsrRenderContext(options: RenderOptions = {}, asyncState?: SsrAsyncRenderState): { context: SsrRenderContext; maxDepth: number; slotManager: SlotManager } {
  const registry: CustomElementRegistryLike = options.customElements ?? (globalThis as any).customElements ?? new IsolateCustomElementRegistry();
  const mode = options.mode ?? 'dsd';
  const resumable = options.resumable ?? true;
  const cssFuse = options.cssFuse ?? true;
  const slotManager = mode === 'dsd' ? SHARED_DSD_SLOT_MANAGER : new SlotManager();
  const compilerBridge = !cssFuse && !resumable && !options.adoptedStyleSheets ? SHARED_STATELESS_COMPILER_BRIDGE : new CompilerBridge();
  const maxDepth = options.depth ?? 100;

  const context: SsrRenderContext = {
    depth: 0,
    resumable,
    domPaths: Boolean(options.domPaths),
    cssFuse,
    mode,
    customElements: registry,
    state: options.state,
    styleDeduplicator: compilerBridge.styleDeduplicator,
    compilerBridge,
    renderValue: (val, ctx) => renderInternal(val, ctx, maxDepth, slotManager),
    parentHost: null,
    contextLookup: createContextLookup(options.context),
    onError: options.onError,
    strictLifecycle: options.strictLifecycle,
    adoptedStyleSheets: options.adoptedStyleSheets,
    asyncState,
    edge: Boolean(options.edge),
    streamingMode: options.streamingMode ?? 'out-of-order',
    nonce: options.nonce,
    deferHydration: Boolean(options.deferHydration),
    litShadowDepth: 0,
    hydratableScope: true,
    customElementRendered: options.customElementRendered,
    excludeElements: options.excludeElements,
    shouldCallConnectedCallback: options.shouldCallConnectedCallback,
    serverElementAdapter: options.serverElementAdapter,
  };

  return { context, maxDepth, slotManager };
}

function* flushStyleDeduplicationScripts(context: SsrRenderContext): IterableIterator<string> {
  if (context.mode !== 'dsd') return;
  const urlEntries = context.styleDeduplicator.flushAdoptedUrlSheets();
  if (urlEntries.length > 0) {
    yield formatAdoptedUrlFallbackScript(urlEntries, context.nonce);
  }
  const adoptState = context.styleDeduplicator.consumePendingInlineAdoption();
  if (adoptState.needsCall) {
    yield formatCssAdoptScript(adoptState.needsBootstrap, context.nonce);
  }
}

export function* render(value: unknown, options: RenderOptions = {}): IterableIterator<string> {
  const { context, maxDepth, slotManager } = createSsrRenderContext(options);
  yield* renderInternal(value, context, maxDepth, slotManager);
  yield* flushStyleDeduplicationScripts(context);
}

export function renderWithPendingBoundaries(
  value: unknown,
  options: RenderOptions = {},
  existingAsyncState?: SsrAsyncRenderState,
  existingContextState?: { context: SsrRenderContext; maxDepth: number; slotManager: SlotManager },
): {
  html: string;
  asyncState: SsrAsyncRenderState;
  context: SsrRenderContext;
  maxDepth: number;
  slotManager: SlotManager;
} {
  const asyncState = existingAsyncState ?? existingContextState?.context.asyncState ?? createAsyncRenderState();
  const { context, maxDepth, slotManager } = existingContextState ?? createSsrRenderContext(options, asyncState);
  let html = '';
  for (const chunk of renderInternal(value, context, maxDepth, slotManager)) {
    html += chunk;
  }
  return { html, asyncState, context, maxDepth, slotManager };
}

function* renderInternal(value: unknown, context: SsrRenderContext, maxDepth: number, slotManager: SlotManager): IterableIterator<string> {
  if (context.depth > maxDepth) {
    throw new RangeError('Maximum SSR render depth exceeded');
  }

  // 1. Null, undefined, Lit sentinels
  if (value === null || value === undefined || isNothing(value)) {
    return;
  }

  // 2. String, number, bigint, boolean
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    yield escapeHtml(String(value));
    return;
  }

  // 2a. Unforgeable trusted raw HTML brand (produced exclusively by unsafeHTML / unsafeSVG directives)
  if (isTrustedRawHtml(value)) {
    yield value.html;
    return;
  }

  // 2b. Async boundary descriptor (e.g., lit/directives/until.js, asyncAppend, asyncReplace, or createAsyncBoundary)
  if (isAsyncBoundaryDescriptor(value)) {
    value.promise.catch(() => {});
    if (context.asyncState && context.mode === 'dsd') {
      const boundaryId = context.asyncState.nextBoundaryId++;
      context.asyncState.boundaries.push({
        id: boundaryId,
        shadowPath: [...context.asyncState.shadowPath],
        promise: value.promise,
        errorFallback: value.errorFallback,
      });
      yield `<!--$b:${boundaryId}-->`;
      yield* renderInternal(value.fallback, context, maxDepth, slotManager);
      yield `<!--/$b:${boundaryId}-->`;
    } else {
      yield* renderInternal(value.fallback, context, maxDepth, slotManager);
    }
    return;
  }

  // 2c. Direct Promise / Thenable child expression
  if (isThenable(value)) {
    const p = Promise.resolve(value);
    p.catch(() => {});
    if (context.asyncState && context.mode === 'dsd') {
      const boundaryId = context.asyncState.nextBoundaryId++;
      context.asyncState.boundaries.push({
        id: boundaryId,
        shadowPath: [...context.asyncState.shadowPath],
        promise: p,
      });
      yield `<!--$b:${boundaryId}--><!--/$b:${boundaryId}-->`;
    }
    return;
  }

  // 2d. Lit DirectiveResult (including renderLight() and directives inside arrays/iterables)
  if (typeof value === 'object' && value !== null && typeof (value as any)._$litDirective$ === 'function') {
    if ((value as any)._$litDirective$._$litRenderLight === true) {
      const lightOut = typeof (context.parentHost as any)?.renderLight === 'function' ? (context.parentHost as any).renderLight() : undefined;
      if (lightOut !== undefined) {
        yield* renderInternal(lightOut, context, maxDepth, slotManager);
      }
      return;
    }
    const resolved = resolveDirectiveValue(value, { type: 2 });
    yield* renderInternal(resolved, context, maxDepth, slotManager);
    return;
  }

  // 3. Arrays / Iterables
  if (
    Array.isArray(value) ||
    (typeof value === 'object' &&
      value !== null &&
      Symbol.iterator in value &&
      typeof (value as any)[Symbol.iterator] === 'function' &&
      !isCompiledTemplateResult(value) &&
      !isStandardTemplateResult(value) &&
      !isElementInstance(value))
  ) {
    context.depth++;
    try {
      for (const item of value as Iterable<unknown>) {
        yield* renderInternal(item, context, maxDepth, slotManager);
      }
    } finally {
      context.depth--;
    }
    return;
  }

  // 4. Ingestion of @lit-core/html-aot compiled template result
  if (isCompiledTemplateResult(value)) {
    let plan = (value._$litType$ as any)?.ssrPlan || descriptorPlanCache.get(value._$litType$);
    if (!plan) {
      if (context.edge) {
        throw new Error('[@lit-core/ssr] Uncompiled Lit template encountered in edge mode. Templates must be compiled ahead of time via @lit-core/html-aot or bundler plugins.');
      }
      plan = compileLitDescriptorPlan(value._$litType$ as any);
      (value._$litType$ as any).ssrPlan = plan;
      descriptorPlanCache.set(value._$litType$, plan);
    }
    const prevHydratable = context.hydratableScope;
    context.hydratableScope = (value as any)._$litServerRenderMode !== 1;
    context.depth++;
    try {
      yield* renderPlanV2Opcodes(plan.opcodes, value.values, context, maxDepth, slotManager);
    } finally {
      context.depth--;
      context.hydratableScope = prevHydratable;
    }
    return;
  }

  // 5. Standard Lit TemplateResult
  if (isStandardTemplateResult(value)) {
    if (context.edge) {
      throw new Error('[@lit-core/ssr] Uncompiled Lit template encountered in edge mode. Templates must be compiled ahead of time via @lit-core/html-aot or bundler plugins.');
    }
    let plan = (value as any)._$litType$?.ssrPlan || templatePlanCache.get(value.strings);
    if (!plan) {
      plan = compileTemplatePlan(Array.from(value.strings));
      templatePlanCache.set(value.strings, plan);
    }
    const templateValues = (value as any).values || [];
    const prevHydratable = context.hydratableScope;
    context.hydratableScope = (value as any)._$litServerRenderMode !== 1;
    context.depth++;
    try {
      yield* renderPlanV2Opcodes(plan.opcodes, templateValues, context, maxDepth, slotManager);
    } finally {
      context.depth--;
      context.hydratableScope = prevHydratable;
    }
    return;
  }

  // 6. Real Custom Element instance (HTMLElementStub or HTMLElement)
  if (isElementInstance(value)) {
    context.depth++;
    try {
      yield* renderComponentInstance(value, context, maxDepth, slotManager);
    } finally {
      context.depth--;
    }
    return;
  }

  // 7. Generic object fallback: always render escaped text (matching Lit client semantics)
  yield escapeHtml(String(value));
}

interface PropertyDeclarationLike {
  attribute?: boolean | string;
  type?: unknown;
  converter?: ((value: string | null, type?: unknown) => unknown) | { fromAttribute?: (value: string | null, type?: unknown) => unknown; toAttribute?: (value: unknown, type?: unknown) => unknown };
  reflect?: boolean;
  state?: boolean;
}

function collectPropertyDeclarations(Ctor: any): Map<string, PropertyDeclarationLike> {
  const map = new Map<string, PropertyDeclarationLike>();
  if (!Ctor) return map;

  try {
    if (typeof Ctor.finalize === 'function') {
      Ctor.finalize();
    }
  } catch {}

  if (Ctor.elementProperties instanceof Map) {
    for (const [key, decl] of Ctor.elementProperties.entries()) {
      if (typeof key === 'string' && decl && typeof decl === 'object') {
        map.set(key, decl as PropertyDeclarationLike);
      }
    }
  }

  // Walk prototype constructors for static `properties` declarations (e.g. props-lower or vanilla classes)
  const ctors: any[] = [];
  let cur = Ctor;
  while (cur && typeof cur === 'function' && cur !== HTMLElementStub && cur !== Function.prototype) {
    ctors.push(cur);
    cur = Object.getPrototypeOf(cur);
  }
  for (let i = ctors.length - 1; i >= 0; i--) {
    const propsObj = ctors[i].properties;
    if (propsObj && typeof propsObj === 'object') {
      for (const [key, decl] of Object.entries(propsObj)) {
        if (!map.has(key)) {
          map.set(key, (decl && typeof decl === 'object' ? decl : {}) as PropertyDeclarationLike);
        }
      }
    }
  }

  return map;
}

function attributeNameForProperty(prop: string, decl: PropertyDeclarationLike): string | null {
  if (decl.state === true || decl.attribute === false) {
    return null;
  }
  if (typeof decl.attribute === 'string') {
    return decl.attribute.toLowerCase();
  }
  return prop.toLowerCase();
}

function defaultFromAttribute(value: string | null, type?: unknown): unknown {
  if (type === Boolean) {
    return value !== null;
  }
  if (type === Number) {
    return value === null ? null : Number(value);
  }
  if (type === Object || type === Array) {
    if (value === null) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function defaultToAttribute(value: unknown, type?: unknown): unknown {
  if (type === Boolean) {
    return value ? '' : null;
  }
  if (type === Object || type === Array) {
    return value == null ? value : JSON.stringify(value);
  }
  return value == null ? value : String(value);
}

function convertPropertyToAttribute(value: unknown, decl: PropertyDeclarationLike): unknown {
  const converter = decl.converter;
  if (converter && typeof converter === 'object' && typeof converter.toAttribute === 'function') {
    return converter.toAttribute(value, decl.type);
  }
  return defaultToAttribute(value, decl.type);
}

function convertAttributeToProperty(value: string | null, decl: PropertyDeclarationLike): unknown {
  const converter = decl.converter;
  if (typeof converter === 'function') {
    return converter(value, decl.type);
  }
  if (converter && typeof converter === 'object' && typeof converter.fromAttribute === 'function') {
    return converter.fromAttribute(value, decl.type);
  }
  return defaultFromAttribute(value, decl.type);
}

interface CtorSsrMeta {
  propDeclarations: Map<string, PropertyDeclarationLike>;
  propNames: string[];
  accessorProps: string[];
  reflectEntries: Array<{ prop: string; attrName: string; decl: PropertyDeclarationLike }>;
  attrToProp: Map<string, { prop: string; decl: PropertyDeclarationLike }>;
  observedSet: Set<string> | null;
  defaultTemplateOpenTag: string;
  plainNoCssFuseShadowPrefix: string;
  reflectionOnlyUpdate: ((changed: Map<PropertyKey, unknown>) => void) | null;
  canFastPathLifecycle: boolean;
  isServerElementCtor: boolean;
  isHydratableLitHost: boolean;
}

const reactiveElementObjCache = new WeakMap<object, any | null>();
const ctorSsrMetaCache = new WeakMap<Function, CtorSsrMeta>();
const propDeclToMetaCache = new WeakMap<Map<string, PropertyDeclarationLike>, CtorSsrMeta>();

function findPrototypeAccessor(proto: any, prop: string): PropertyDescriptor | undefined {
  let cur = proto;
  while (cur && cur !== HTMLElementStub.prototype && cur !== Object.prototype) {
    const desc = Object.getOwnPropertyDescriptor(cur, prop);
    if (desc && (typeof desc.get === 'function' || typeof desc.set === 'function')) {
      return desc;
    }
    cur = Object.getPrototypeOf(cur);
  }
  return undefined;
}

function findReactiveElementPrototype(instance: any): any | null {
  const start = Object.getPrototypeOf(instance);
  if (!start || typeof start !== 'object') return null;
  const cached = reactiveElementObjCache.get(start);
  if (cached !== undefined) {
    return cached;
  }
  let cur = start;
  while (cur && cur !== HTMLElementStub.prototype && cur !== Object.prototype) {
    if (Object.hasOwn(cur, 'performUpdate') && Object.hasOwn(cur, 'update')) {
      reactiveElementObjCache.set(start, cur);
      return cur;
    }
    cur = Object.getPrototypeOf(cur);
  }
  reactiveElementObjCache.set(start, null);
  return null;
}

function getCtorSsrMeta(Ctor: any): CtorSsrMeta {
  if (typeof Ctor === 'function') {
    const cached = ctorSsrMetaCache.get(Ctor);
    if (cached !== undefined) {
      return cached;
    }
  }

  const propDeclarations = collectPropertyDeclarations(Ctor);
  const propNames: string[] = [];
  const accessorProps: string[] = [];
  const reflectEntries: Array<{ prop: string; attrName: string; decl: PropertyDeclarationLike }> = [];
  const attrToProp = new Map<string, { prop: string; decl: PropertyDeclarationLike }>();
  const targetPrototype = Ctor?.prototype;

  for (const [prop, decl] of propDeclarations.entries()) {
    propNames.push(prop);
    const attrName = attributeNameForProperty(prop, decl);
    if (attrName) {
      attrToProp.set(attrName, { prop, decl });
      if (decl.reflect === true) {
        reflectEntries.push({ prop, attrName, decl });
      }
    }
    if (targetPrototype) {
      const acc = findPrototypeAccessor(targetPrototype, prop);
      if (acc && typeof acc.set === 'function') {
        accessorProps.push(prop);
      }
    }
  }

  const observed: string[] | undefined = Ctor?.observedAttributes;
  const observedSet = Array.isArray(observed) ? new Set(observed.map((a) => String(a).toLowerCase())) : null;
  const shadowOpts = Ctor?.shadowRootOptions;
  const shadowMode = shadowOpts?.mode === 'closed' ? 'closed' : 'open';
  const delegatesAttr = shadowOpts?.delegatesFocus ? ' shadowrootdelegatesfocus' : '';
  const defaultTemplateOpenTag = `<template shadowrootmode="${shadowMode}"${delegatesAttr}>`;

  let reflectionOnlyUpdate: ((changed: Map<PropertyKey, unknown>) => void) | null = null;
  let reactiveProto: any = null;
  let litElementProto: any = null;
  if (targetPrototype) {
    let cur = targetPrototype;
    while (cur && cur !== HTMLElementStub.prototype && cur !== Object.prototype) {
      if (litElementProto === null && cur.constructor && Object.hasOwn(cur.constructor, '_$litElement$') && cur.constructor._$litElement$ === true) {
        litElementProto = cur;
      }
      if (reactiveProto === null && Object.hasOwn(cur, 'performUpdate') && Object.hasOwn(cur, 'update')) {
        reactiveProto = cur;
        const baseReactiveUpdate = cur.update;
        reflectionOnlyUpdate = function (this: any, changed: Map<PropertyKey, unknown>) {
          baseReactiveUpdate.call(this, changed);
        };
      }
      if (litElementProto !== null && reactiveProto !== null) {
        break;
      }
      cur = Object.getPrototypeOf(cur);
    }
  }

  const canFastPathLifecycle = Boolean(
    targetPrototype &&
      reactiveProto !== null &&
      litElementProto !== null &&
      targetPrototype.connectedCallback === litElementProto.connectedCallback &&
      targetPrototype.createRenderRoot === litElementProto.createRenderRoot &&
      targetPrototype.shouldUpdate === reactiveProto.shouldUpdate &&
      targetPrototype.performUpdate === reactiveProto.performUpdate &&
      targetPrototype.willUpdate === reactiveProto.willUpdate &&
      reflectEntries.length === 0 &&
      accessorProps.length === propNames.length,
  );

  const isServerElementCtor = Boolean(
    Ctor?.[Symbol.for('@lit-core/server-elements/element')] || Ctor?.[Symbol.for('@lit-core/server-elements/loader')] || Ctor?.[Symbol.for('@lit-core/server-elements/action')],
  );
  const isHydratableLitHost = Boolean(Ctor?._$litElement$) && !isServerElementCtor;
  const plainNoCssFuseShadowPrefix = defaultTemplateOpenTag + SHARED_STATELESS_COMPILER_BRIDGE.styleDeduplicator.resolveDefaultStyleTag(Ctor, false).styleTag;

  const meta: CtorSsrMeta = {
    propDeclarations,
    propNames,
    accessorProps,
    reflectEntries,
    attrToProp,
    observedSet,
    defaultTemplateOpenTag,
    plainNoCssFuseShadowPrefix,
    reflectionOnlyUpdate,
    canFastPathLifecycle,
    isServerElementCtor,
    isHydratableLitHost,
  };
  if (typeof Ctor === 'function') {
    ctorSsrMetaCache.set(Ctor, meta);
  }
  propDeclToMetaCache.set(propDeclarations, meta);
  return meta;
}

function repairShadowedClassFields(instance: any, accessorProps: readonly string[]): void {
  for (let i = 0; i < accessorProps.length; i++) {
    const prop = accessorProps[i];
    if (!Object.hasOwn(instance, prop)) continue;
    const ownDesc = Object.getOwnPropertyDescriptor(instance, prop);
    if (ownDesc && 'value' in ownDesc && ownDesc.configurable) {
      const currentValue = ownDesc.value;
      delete instance[prop];
      if (currentValue !== undefined) {
        instance[prop] = currentValue;
      }
    }
  }
}

function buildLightDomStubsFromOpcodes(opcodes: SsrOpcode[], values: unknown[], start: number, end: number): { children: HTMLElementStub[]; childNodes: any[] } {
  const children: HTMLElementStub[] = [];
  const childNodes: any[] = [];
  let idx = start;

  while (idx < end) {
    const op = opcodes[idx];
    if (op.type === 'open') {
      const childEl = new HTMLElementStub(op.tag);
      if (op.staticAttrs) {
        for (const [k, v] of Object.entries(op.staticAttrs)) {
          childEl.setAttribute(k, v);
        }
      }
      if (op.dynamicAttrs) {
        for (const dyn of op.dynamicAttrs) {
          if (dyn.type === 'attribute') {
            if (dyn.indices && dyn.strings) {
              let formatted = dyn.strings[0] ?? '';
              for (let j = 0; j < dyn.indices.length; j++) {
                const vIdx = dyn.indices[j];
                const rawVal = vIdx < values.length ? values[vIdx] : undefined;
                const resolved = resolveDirectiveValue(rawVal, { type: 1, name: dyn.name, strings: dyn.strings });
                formatted += !isNothing(resolved) && resolved !== null && resolved !== undefined ? String(resolved) : '';
                formatted += dyn.strings[j + 1] ?? '';
              }
              childEl.setAttribute(dyn.name, formatted);
            } else {
              const rawVal = dyn.index < values.length ? values[dyn.index] : undefined;
              const resolved = resolveDirectiveValue(rawVal, { type: 1, name: dyn.name, strings: dyn.strings });
              if (!isNothing(resolved) && resolved !== null && resolved !== undefined) {
                const formatted = dyn.strings && dyn.strings.length > 1 ? dyn.strings[0] + String(resolved) + dyn.strings.slice(1).join('') : String(resolved);
                childEl.setAttribute(dyn.name, formatted);
              }
            }
          } else if (dyn.type === 'boolean') {
            const rawVal = dyn.index < values.length ? values[dyn.index] : undefined;
            const resolved = resolveDirectiveValue(rawVal, { type: 4, name: dyn.name });
            if (resolved && !isNothing(resolved)) {
              childEl.setAttribute(dyn.name, '');
            }
          } else if (dyn.type === 'property') {
            const rawVal = dyn.index < values.length ? values[dyn.index] : undefined;
            const resolved = resolveDirectiveValue(rawVal, { type: 3, name: dyn.name });
            defineElementProperty(childEl, dyn.name, resolved);
          }
        }
      }

      const closeIdx = findMatchingCloseTag(opcodes, idx, end);
      if (!op.isVoid && !op.isSelfClosing && closeIdx > idx) {
        if (closeIdx > idx + 1) {
          const nested = buildLightDomStubsFromOpcodes(opcodes, values, idx + 1, closeIdx);
          childEl._ssrLightChildren = nested.children;
          childEl._ssrLightChildNodes = nested.childNodes;
        }
        idx = closeIdx + 1;
      } else {
        idx++;
      }

      children.push(childEl);
      childNodes.push(childEl);
    } else if (op.type === 'text') {
      if (op.value.length > 0) {
        childNodes.push({ nodeType: 3, data: op.value, textContent: op.value });
      }
      idx++;
    } else if (op.type === 'part') {
      const rawVal = op.index < values.length ? values[op.index] : undefined;
      const resolved = resolveDirectiveValue(rawVal, { type: 2 });
      if (isElementInstance(resolved)) {
        children.push(resolved);
        childNodes.push(resolved);
      } else if (resolved !== null && resolved !== undefined && !isNothing(resolved) && typeof resolved !== 'object') {
        const text = String(resolved);
        if (text.length > 0) {
          childNodes.push({ nodeType: 3, data: text, textContent: text });
        }
      }
      idx++;
    } else {
      idx++;
    }
  }

  return { children, childNodes };
}

export interface ComponentLifecycleInput {
  instance: any;
  Ctor: any;
  tagName: string;
  staticAttrs?: Record<string, string>;
  dynamicAttrs?: SsrDynamicAttribute[];
  values?: unknown[];
  lightOpcodes?: { opcodes: SsrOpcode[]; values: unknown[]; start: number; end: number };
  parentHost?: HTMLElementStub | null;
  contextLookup?: (key: unknown) => { found: boolean; value: unknown };
  onError?: (error: unknown, info: { tagName?: string; phase: string }) => void;
  strictLifecycle?: boolean;
  resumable?: boolean;
  deferHydration?: boolean;
  shouldCallConnectedCallback?: (tagName: string, instance: unknown) => boolean;
  skipChangedTracking?: boolean;
}

const SHARED_EMPTY_CHANGED_MAP = new Map<PropertyKey, unknown>();

function attachNonStubDomSurface(instance: any): void {
  if (instance instanceof HTMLElementStub) {
    return;
  }
  if (!Array.isArray(instance._ssrLightChildren)) {
    defineElementProperty(instance, '_ssrLightChildren', []);
  }
  if (!Array.isArray(instance._ssrLightChildNodes)) {
    defineElementProperty(instance, '_ssrLightChildNodes', []);
  }

  const accessorKeys = ['children', 'childNodes', 'childElementCount', 'firstChild', 'lastChild', 'firstElementChild', 'lastElementChild', 'textContent', 'ownerDocument'] as const;
  for (const key of accessorKeys) {
    if (key in instance && instance[key] !== undefined) continue;
    const desc = Object.getOwnPropertyDescriptor(HTMLElementStub.prototype, key);
    if (desc) {
      try {
        Object.defineProperty(instance, key, { ...desc, enumerable: false, configurable: true });
      } catch {}
    }
  }

  const methodKeys = ['querySelector', 'querySelectorAll', 'closest', 'contains', 'getRootNode', 'attachInternals'] as const;
  for (const key of methodKeys) {
    if (typeof instance[key] !== 'function') {
      defineElementProperty(instance, key, (HTMLElementStub.prototype as any)[key]);
    }
  }
  if (typeof instance.getRootNode === 'function') {
    const origGetRootNode = instance.getRootNode.bind(instance);
    defineElementProperty(instance, 'getRootNode', function (this: any, options?: any) {
      const root = origGetRootNode(options);
      if (root && typeof root.querySelector === 'function') {
        return root;
      }
      return this;
    });
  }

  if (typeof instance.getAttributeNames !== 'function' && Array.isArray(instance.attributes)) {
    defineElementProperty(instance, 'getAttributeNames', function (this: any): string[] {
      return Array.isArray(this.attributes) ? this.attributes.map((a: any) => String(a.name)) : [];
    });
  }

  const ensureShadowRootSurface = (sr: any) => {
    if (!sr || typeof sr !== 'object') return sr;
    if (!Array.isArray(sr.childNodes)) {
      defineElementProperty(sr, 'childNodes', []);
    }
    if (!Array.isArray(sr.children)) {
      defineElementProperty(sr, 'children', []);
    }
    if (!Array.isArray(sr.adoptedStyleSheets)) {
      defineElementProperty(sr, 'adoptedStyleSheets', []);
    }
    const srMethods = [
      'appendChild',
      'removeChild',
      'insertBefore',
      'append',
      'prepend',
      'querySelector',
      'querySelectorAll',
      'getElementById',
      'addEventListener',
      'removeEventListener',
      'dispatchEvent',
    ] as const;
    for (const m of srMethods) {
      if (typeof sr[m] !== 'function') {
        defineElementProperty(sr, m, (ShadowRootStub.prototype as any)[m]);
      }
    }
    return sr;
  };

  if (instance.__internals && typeof instance.__internals === 'object' && instance.__internals.validity && Object.getPrototypeOf(instance.__internals.validity) === Object.prototype) {
    Object.setPrototypeOf(instance.__internals.validity, ValidityStateStub.prototype);
  }

  if (instance.shadowRoot) {
    ensureShadowRootSurface(instance.shadowRoot);
  }
  if (typeof instance.attachShadow === 'function') {
    const origAttachShadow = instance.attachShadow.bind(instance);
    defineElementProperty(instance, 'attachShadow', (init: ShadowRootInit = { mode: 'open' }) => {
      const sr = origAttachShadow(init);
      return ensureShadowRootSurface(sr);
    });
  }

  // If `@lit/reactive-element` was evaluated in Node before `installIsolateGlobals()`, its module-scoped
  // `supportsAdoptingStyleSheets` flag was captured as false (`adoptStyles` falls back to `document.createElement`).
  // When `globalThis.document` is absent and the subclass did not override `createRenderRoot`, adopt sheets on the
  // ephemeral instance directly without mutating `ReactiveElement.prototype` or `globalThis`.
  if (typeof (globalThis as any).document === 'undefined') {
    const reactiveProto = findReactiveElementPrototype(instance);
    if (reactiveProto) {
      let hasUserCreateRenderRootOverride = false;
      let cursor = Object.getPrototypeOf(instance);
      while (cursor && cursor !== reactiveProto && cursor !== Object.prototype) {
        if (cursor.constructor?._$litElement$ === true) {
          break;
        }
        if (Object.hasOwn(cursor, 'createRenderRoot')) {
          hasUserCreateRenderRootOverride = true;
          break;
        }
        cursor = Object.getPrototypeOf(cursor);
      }

      if (!hasUserCreateRenderRootOverride) {
        defineElementProperty(instance, 'createRenderRoot', function (this: any) {
          const root = this.shadowRoot ?? this.attachShadow(this.constructor?.shadowRootOptions ?? { mode: 'open' });
          const styles = this.constructor?.elementStyles;
          if (root && Array.isArray(styles)) {
            root.adoptedStyleSheets = styles.map((s: any) => {
              if (s instanceof CSSStyleSheetStub) return s;
              if (s?.styleSheet) return s.styleSheet;
              const sheet = new CSSStyleSheetStub();
              if (typeof s?.cssText === 'string') {
                sheet.replaceSync(s.cssText);
              }
              return sheet;
            });
          }
          if (this.renderOptions && typeof this.renderOptions === 'object') {
            this.renderOptions.renderBefore ??= root?.firstChild;
          }
          return root;
        });
      }
    }
  }

  const origDispatch = typeof instance.dispatchEvent === 'function' ? instance.dispatchEvent.bind(instance) : null;
  defineElementProperty(instance, 'dispatchEvent', function (this: any, event: any): boolean {
    if (origDispatch) {
      origDispatch(event);
    }
    if (event?.bubbles && !event?.cancelBubble && !event?._propagationStopped && this._ssrParentHost && this.__eventTargetParent !== this._ssrParentHost) {
      this._ssrParentHost.dispatchEvent?.(event);
    }
    if (event?.type === 'context-request' && typeof event.callback === 'function' && !event._ssrHandled && !event?.cancelBubble && !event?._propagationStopped) {
      return HTMLElementStub.prototype.dispatchEvent.call(this, event);
    }
    return !event?.defaultPrevented;
  });
}

function hasFrozenPrototypeInChain(instance: any): boolean {
  let cur = Object.getPrototypeOf(instance);
  while (cur && cur !== Object.prototype) {
    if (Object.isFrozen(cur)) return true;
    cur = Object.getPrototypeOf(cur);
  }
  return false;
}

function setInstanceOverride(instance: any, prop: string, value: unknown, useDefine: boolean): void {
  if (useDefine) {
    Object.defineProperty(instance, prop, {
      value,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  } else {
    instance[prop] = value;
  }
}

export function prepareComponentBindings(input: ComponentLifecycleInput): {
  propDeclarations: Map<string, PropertyDeclarationLike>;
  changedProperties: Map<PropertyKey, unknown>;
  eventAttrs: string[];
} {
  const { instance, Ctor, tagName, staticAttrs, dynamicAttrs, values } = input;
  const meta = getCtorSsrMeta(Ctor);
  const tagUpper = tagName.toUpperCase();
  if (instance instanceof HTMLElementStub) {
    instance.tagName = tagUpper;
    instance.isConnected = true;
    const willFastPathConnect =
      Boolean(input.skipChangedTracking && meta.canFastPathLifecycle) &&
      !(instance as any)._$EO?.size &&
      !(instance as any).__controllers?.size &&
      !(instance as any)._controllers?.size &&
      !(instance as any).__internals &&
      !Object.hasOwn(instance, 'connectedCallback') &&
      !Object.hasOwn(instance, 'willUpdate');
    if (!willFastPathConnect && typeof (instance as any).enableUpdating === 'function') {
      setInstanceOverride(instance, 'enableUpdating', NOOP_RENDER_FN, hasFrozenPrototypeInChain(instance));
    }
  } else {
    defineElementProperty(instance, 'tagName', tagUpper);
    defineElementProperty(instance, 'localName', tagName.toLowerCase());
    defineElementProperty(instance, 'isConnected', true);
    if (typeof instance.enableUpdating === 'function') {
      defineElementProperty(instance, 'enableUpdating', NOOP_RENDER_FN);
    }
    attachNonStubDomSurface(instance);
  }

  const { propDeclarations, propNames, accessorProps, attrToProp, observedSet, reflectEntries, reflectionOnlyUpdate } = meta;
  if (accessorProps.length > 0) {
    repairShadowedClassFields(instance, accessorProps);
  }

  const canSkipChangedMap = Boolean(input.skipChangedTracking && reflectionOnlyUpdate !== null && reflectEntries.length === 0 && accessorProps.length === propNames.length);
  const changedProperties = canSkipChangedMap ? SHARED_EMPTY_CHANGED_MAP : new Map<PropertyKey, unknown>();

  if (!canSkipChangedMap) {
    for (let i = 0; i < propNames.length; i++) {
      const prop = propNames[i];
      try {
        if (instance[prop] !== undefined) {
          changedProperties.set(prop, undefined);
        }
      } catch {}
    }
  }

  const hasStaticAttrs = Boolean(staticAttrs);
  const hasDynamicAttrs = Boolean(dynamicAttrs && dynamicAttrs.length > 0 && values);

  if (hasStaticAttrs || hasDynamicAttrs) {
    const setHostAttrAndSyncProperty = (rawName: string, attrValue: string | null) => {
      const lower = rawName.toLowerCase();
      if (lower === 'data-lit-ssr') return;

      const prevAttr = typeof instance.getAttribute === 'function' ? instance.getAttribute(lower) : null;
      if (attrValue === null) {
        if (typeof instance.removeAttribute === 'function') {
          instance.removeAttribute(lower);
        }
      } else if (typeof instance.setAttribute === 'function') {
        instance.setAttribute(lower, attrValue);
      }

      const mapped = attrToProp.get(lower);
      if (typeof instance.attributeChangedCallback === 'function' && (!observedSet || observedSet.has(lower))) {
        instance.attributeChangedCallback(lower, prevAttr, attrValue);
        if (!canSkipChangedMap && mapped && !changedProperties.has(mapped.prop)) {
          changedProperties.set(mapped.prop, undefined);
        }
      } else if (mapped) {
        const converted = convertAttributeToProperty(attrValue, mapped.decl);
        defineElementProperty(instance, mapped.prop, converted);
        if (!canSkipChangedMap && !changedProperties.has(mapped.prop)) {
          changedProperties.set(mapped.prop, undefined);
        }
      } else if (rawName in instance && typeof instance[rawName] !== 'function') {
        instance[rawName] = attrValue === null ? false : attrValue;
        if (!canSkipChangedMap && !changedProperties.has(rawName)) {
          changedProperties.set(rawName, undefined);
        }
      }
    };

    if (staticAttrs) {
      for (const [name, value] of Object.entries(staticAttrs)) {
        setHostAttrAndSyncProperty(name, value);
      }
    }

    let eventAttrs: string[] | null = null;
    if (dynamicAttrs && values) {
      for (let i = 0; i < dynamicAttrs.length; i++) {
        const dyn = dynamicAttrs[i];
        if (dyn.type === 'directive') {
          // ElementPart directives only execute `update(part, args)` on live client DOM elements;
          // per Lit SSR semantics, `render()` must not be invoked on the server.
          continue;
        }
        if (dyn.type === 'event') {
          if (input.resumable && isValidAttrName(`resumes-on-${dyn.name}`)) {
            (eventAttrs ??= []).push(`resumes-on-${dyn.name}`);
          }
          continue;
        }
        if ('name' in dyn && dyn.name) {
          if (dyn.type === 'property') {
            if (dyn.indices && dyn.strings) {
              let formatted = dyn.strings[0] ?? '';
              let omitted = false;
              for (let j = 0; j < dyn.indices.length; j++) {
                const idx = dyn.indices[j];
                const rawVal = idx < values.length ? values[idx] : undefined;
                const resolved = resolveDirectiveValue(rawVal, { type: 3, tagName: tagUpper, name: dyn.name, strings: dyn.strings });
                if (isNothing(resolved)) {
                  omitted = true;
                } else if (resolved !== null && resolved !== undefined) {
                  formatted += String(resolved);
                }
                formatted += dyn.strings[j + 1] ?? '';
              }
              if (!omitted) {
                defineElementProperty(instance, dyn.name, formatted);
                if (!canSkipChangedMap && !changedProperties.has(dyn.name)) {
                  changedProperties.set(dyn.name, undefined);
                }
              }
            } else {
              const rawVal = dyn.index < values.length ? values[dyn.index] : undefined;
              const resolved = resolveDirectiveValue(rawVal, { type: 3, tagName: tagUpper, name: dyn.name, strings: dyn.strings });
              if (!isNothing(resolved)) {
                const finalVal =
                  dyn.strings && dyn.strings.length > 1 ? dyn.strings[0] + (resolved !== null && resolved !== undefined ? String(resolved) : '') + dyn.strings.slice(1).join('') : resolved;
                defineElementProperty(instance, dyn.name, finalVal);
                if (!canSkipChangedMap && !changedProperties.has(dyn.name)) {
                  changedProperties.set(dyn.name, undefined);
                }
              }
            }
          } else if (dyn.type === 'boolean') {
            const rawVal = dyn.index < values.length ? values[dyn.index] : undefined;
            const resolved = resolveDirectiveValue(rawVal, { type: 4, tagName: tagUpper, name: dyn.name });
            const boolVal = Boolean(resolved) && !isNothing(resolved);
            setHostAttrAndSyncProperty(dyn.name, boolVal ? '' : null);
          } else if (dyn.type === 'attribute') {
            if (dyn.indices && dyn.strings) {
              let formatted = dyn.strings[0] ?? '';
              for (let j = 0; j < dyn.indices.length; j++) {
                const idx = dyn.indices[j];
                const rawVal = idx < values.length ? values[idx] : undefined;
                const resolved = resolveDirectiveValue(rawVal, { type: 1, tagName: tagUpper, name: dyn.name, strings: dyn.strings });
                formatted += !isNothing(resolved) && resolved !== null && resolved !== undefined ? String(resolved) : '';
                formatted += dyn.strings[j + 1] ?? '';
              }
              setHostAttrAndSyncProperty(dyn.name, formatted);
            } else {
              const rawVal = dyn.index < values.length ? values[dyn.index] : undefined;
              const resolved = resolveDirectiveValue(rawVal, { type: 1, tagName: tagUpper, name: dyn.name, strings: dyn.strings });
              if (!isNothing(resolved) && resolved !== undefined && resolved !== null) {
                const formatted = dyn.strings && dyn.strings.length > 1 ? dyn.strings[0] + String(resolved) + dyn.strings.slice(1).join('') : String(resolved);
                setHostAttrAndSyncProperty(dyn.name, formatted);
              } else if (isNothing(resolved) || resolved === null || resolved === undefined) {
                setHostAttrAndSyncProperty(dyn.name, null);
              }
            }
          }
        }
      }
    }

    if (input.lightOpcodes && input.lightOpcodes.start < input.lightOpcodes.end) {
      const stubs = buildLightDomStubsFromOpcodes(input.lightOpcodes.opcodes, input.lightOpcodes.values, input.lightOpcodes.start, input.lightOpcodes.end);
      if (instance instanceof HTMLElementStub) {
        instance._ssrLightChildren = stubs.children;
        instance._ssrLightChildNodes = stubs.childNodes;
      } else {
        defineElementProperty(instance, '_ssrLightChildren', stubs.children);
        defineElementProperty(instance, '_ssrLightChildNodes', stubs.childNodes);
      }
    }

    return { propDeclarations, changedProperties, eventAttrs: eventAttrs ?? EMPTY_EVENT_ATTRS };
  }

  if (input.lightOpcodes && input.lightOpcodes.start < input.lightOpcodes.end) {
    const stubs = buildLightDomStubsFromOpcodes(input.lightOpcodes.opcodes, input.lightOpcodes.values, input.lightOpcodes.start, input.lightOpcodes.end);
    if (instance instanceof HTMLElementStub) {
      instance._ssrLightChildren = stubs.children;
      instance._ssrLightChildNodes = stubs.childNodes;
    } else {
      defineElementProperty(instance, '_ssrLightChildren', stubs.children);
      defineElementProperty(instance, '_ssrLightChildNodes', stubs.childNodes);
    }
  }

  return { propDeclarations, changedProperties, eventAttrs: EMPTY_EVENT_ATTRS };
}

export function executeComponentLifecycleAndReflection(
  instance: any,
  tagName: string,
  propDeclarations: Map<string, PropertyDeclarationLike>,
  changedProperties: Map<PropertyKey, unknown>,
  options: {
    parentHost?: HTMLElementStub | null;
    contextLookup?: (key: unknown) => { found: boolean; value: unknown };
    onError?: (error: unknown, info: { tagName?: string; phase: string }) => void;
    strictLifecycle?: boolean;
    deferHydration?: boolean;
    shouldCallConnectedCallback?: (tagName: string, instance: unknown) => boolean;
  } = {},
): void {
  if (instance instanceof HTMLElementStub) {
    instance._ssrParentHost = options.parentHost ?? null;
    if (options.contextLookup) {
      instance._ssrContextLookup = options.contextLookup;
    }
  } else {
    defineElementProperty(instance, '_ssrParentHost', options.parentHost ?? null);
    if (options.parentHost && typeof instance.__resolveFullEventPath === 'function' && typeof (options.parentHost as any).__resolveFullEventPath === 'function') {
      defineElementProperty(instance, '__eventTargetParent', options.parentHost);
    }
    if (options.contextLookup) {
      defineElementProperty(instance, '_ssrContextLookup', options.contextLookup);
    }
  }

  const meta = propDeclToMetaCache.get(propDeclarations);
  const fastSkippedChanged = changedProperties === SHARED_EMPTY_CHANGED_MAP && meta !== undefined && meta.reflectionOnlyUpdate !== null && meta.reflectEntries.length === 0;
  if (
    fastSkippedChanged &&
    meta.canFastPathLifecycle &&
    instance instanceof HTMLElementStub &&
    !options.shouldCallConnectedCallback &&
    !(instance as any)._$EO?.size &&
    !(instance as any).__controllers?.size &&
    !(instance as any)._controllers?.size &&
    !(instance as any).__internals &&
    !Object.hasOwn(instance, 'connectedCallback') &&
    !Object.hasOwn(instance, 'willUpdate')
  ) {
    (instance as any).isUpdatePending = false;
    return;
  }

  const propNames = fastSkippedChanged ? EMPTY_EVENT_ATTRS : meta ? meta.propNames : Array.from(propDeclarations.keys());
  let preConnectValues: unknown[] | null = null;
  if (!fastSkippedChanged && propNames.length > 0) {
    preConnectValues = new Array(propNames.length);
    for (let i = 0; i < propNames.length; i++) {
      try {
        preConnectValues[i] = instance[propNames[i]];
      } catch {}
    }
  }

  const reactiveProto = findReactiveElementPrototype(instance);

  const shouldConnect = options.shouldCallConnectedCallback ? options.shouldCallConnectedCallback(tagName, instance) : true;
  if (shouldConnect) {
    try {
      instance.connectedCallback?.();
    } catch (err) {
      options.onError?.(err, { tagName, phase: 'connectedCallback' });
      if (options.strictLifecycle) {
        throw err;
      }
    }
  }

  if (preConnectValues) {
    for (let i = 0; i < propNames.length; i++) {
      const prop = propNames[i];
      try {
        const cur = instance[prop];
        const prev = preConnectValues[i];
        if (!Object.is(cur, prev) || (cur !== undefined && !changedProperties.has(prop))) {
          if (!changedProperties.has(prop)) {
            changedProperties.set(prop, prev);
          }
        }
      } catch {}
    }
  }

  if (reactiveProto) {
    // Run Lit's genuine ReactiveElement update cycle (`shouldUpdate` -> `willUpdate` -> controller `hostUpdate` -> reflection-only `ReactiveElement.prototype.update`)
    // synchronously without enqueuing a phantom `requestUpdate()` / `scheduleUpdate()` microtask.
    const useDefine = hasFrozenPrototypeInChain(instance);
    const prevUpdate = instance.update;
    const prevFirstUpdated = instance.firstUpdated;
    const prevUpdated = instance.updated;
    const updateOverride =
      fastSkippedChanged && meta.reflectionOnlyUpdate
        ? meta.reflectionOnlyUpdate
        : function (this: any, changed: Map<PropertyKey, unknown>) {
            for (const [k, v] of changed.entries()) {
              if (!changedProperties.has(k)) {
                changedProperties.set(k, v);
              }
            }
            reactiveProto.update.call(this, changed);
          };

    setInstanceOverride(instance, 'update', updateOverride, useDefine);
    setInstanceOverride(instance, 'firstUpdated', NOOP_RENDER_FN, useDefine);
    setInstanceOverride(instance, 'updated', NOOP_RENDER_FN, useDefine);

    try {
      setInstanceOverride(instance, 'isUpdatePending', true, useDefine);
      instance.performUpdate();
    } catch (err) {
      options.onError?.(err, { tagName, phase: 'willUpdate' });
      throw err;
    } finally {
      setInstanceOverride(instance, 'update', prevUpdate, useDefine);
      setInstanceOverride(instance, 'firstUpdated', prevFirstUpdated, useDefine);
      setInstanceOverride(instance, 'updated', prevUpdated, useDefine);
    }
  } else {
    try {
      instance.willUpdate?.(changedProperties);
    } catch (err) {
      options.onError?.(err, { tagName, phase: 'willUpdate' });
      throw err;
    }
    if (typeof instance._invokeControllersHostUpdate === 'function') {
      instance._invokeControllersHostUpdate();
    }
  }

  // Reflect ElementInternals AOM ARIA properties onto host attributes when unset on the host.
  const internals = instance?.__internals;
  if (internals && typeof internals === 'object') {
    for (let i = 0; i < ARIA_MIXIN_ENTRIES.length; i++) {
      const entry = ARIA_MIXIN_ENTRIES[i];
      const value = internals[entry[0]];
      if (value !== undefined && value !== null && value !== '') {
        const ariaAttr = entry[1];
        if (!(typeof instance.hasAttribute === 'function' && instance.hasAttribute(ariaAttr))) {
          const strVal = String(value);
          instance.setAttribute?.(ariaAttr, strVal);
          instance.setAttribute?.(`${HYDRATE_INTERNALS_ATTR_PREFIX}${ariaAttr}`, strVal);
        }
      }
    }
  }

  // Ensure all declared `reflect: true` properties (including lowered or non-ReactiveElement classes)
  // reflect their post-willUpdate values onto the host element's attributes.
  if (meta) {
    const reflectEntries = meta.reflectEntries;
    for (let i = 0; i < reflectEntries.length; i++) {
      const { prop, attrName, decl } = reflectEntries[i];
      let val: unknown;
      try {
        val = instance[prop];
      } catch {
        continue;
      }
      if (val === undefined && !changedProperties.has(prop) && !(typeof instance.hasAttribute === 'function' && instance.hasAttribute(attrName))) {
        continue;
      }
      const attrVal = convertPropertyToAttribute(val, decl);
      if (attrVal === undefined) {
        continue;
      }
      if (attrVal === null) {
        instance.removeAttribute?.(attrName);
      } else {
        instance.setAttribute?.(attrName, String(attrVal));
      }
    }
  } else {
    for (const [prop, decl] of propDeclarations.entries()) {
      if (decl.reflect !== true) continue;
      const attrName = attributeNameForProperty(prop, decl);
      if (!attrName) continue;
      let val: unknown;
      try {
        val = instance[prop];
      } catch {
        continue;
      }
      if (val === undefined && !changedProperties.has(prop) && !(typeof instance.hasAttribute === 'function' && instance.hasAttribute(attrName))) {
        continue;
      }
      const attrVal = convertPropertyToAttribute(val, decl);
      if (attrVal === undefined) {
        continue;
      }
      if (attrVal === null) {
        if (typeof instance.removeAttribute === 'function') {
          instance.removeAttribute(attrName);
        }
      } else if (typeof instance.setAttribute === 'function') {
        instance.setAttribute(attrName, String(attrVal));
      }
    }
  }
}

export function prepareAndRunComponentLifecycle(input: ComponentLifecycleInput): {
  propDeclarations: Map<string, PropertyDeclarationLike>;
  changedProperties: Map<PropertyKey, unknown>;
  eventAttrs: string[];
} {
  const prepared = prepareComponentBindings(input);
  executeComponentLifecycleAndReflection(input.instance, input.tagName, prepared.propDeclarations, prepared.changedProperties, {
    parentHost: input.parentHost,
    contextLookup: input.contextLookup,
    onError: input.onError,
    strictLifecycle: input.strictLifecycle,
    deferHydration: input.deferHydration,
    shouldCallConnectedCallback: input.shouldCallConnectedCallback,
  });
  return prepared;
}

export function readLiveHostAttributesMap(instance: any): Map<string, string> {
  const map = new Map<string, string>();
  if (instance instanceof HTMLElementStub) {
    const raw = instance._getRawAttributesMap();
    if (!raw || raw.size === 0) {
      return map;
    }
    for (const [name, val] of raw) {
      if (isValidAttrName(name)) {
        map.set(name, val);
      }
    }
    return map;
  }
  if (typeof instance?.getAttributeNames === 'function' && typeof instance?.getAttribute === 'function') {
    for (const name of instance.getAttributeNames()) {
      if (!isValidAttrName(name)) continue;
      const val = instance.getAttribute(name);
      if (val !== null) {
        map.set(name, val);
      }
    }
  } else if (instance?.attributes && typeof instance.attributes[Symbol.iterator] === 'function') {
    for (const attr of instance.attributes) {
      if (attr && typeof attr.name === 'string' && isValidAttrName(attr.name)) {
        map.set(attr.name, String(attr.value ?? ''));
      }
    }
  }
  return map;
}

function serializeHostAttributeString(
  instance: any,
  options: {
    eventAttrs?: readonly string[];
    adoptKeys?: readonly string[];
    adoptedUrls?: readonly string[];
    hostId?: number;
    stateJson?: string;
    domPaths?: boolean;
    deferHydration?: boolean;
  } = {},
): string {
  if (
    instance instanceof HTMLElementStub &&
    !options.domPaths &&
    (!options.adoptKeys || options.adoptKeys.length === 0) &&
    (!options.adoptedUrls || options.adoptedUrls.length === 0) &&
    options.hostId === undefined &&
    !options.stateJson &&
    (!options.eventAttrs || options.eventAttrs.length === 0)
  ) {
    const raw = instance._getRawAttributesMap();
    if (!raw || raw.size === 0) {
      return options.deferHydration ? ' defer-hydration' : '';
    }
    let out = '';
    let hasDefer = false;
    for (const [k, v] of raw) {
      if (!isValidAttrName(k)) continue;
      if (k === 'defer-hydration') hasDefer = true;
      out += v === '' ? ` ${k}` : ` ${k}="${escapeAttribute(v)}"`;
    }
    if (options.deferHydration && !hasDefer) {
      out += ' defer-hydration';
    }
    return out;
  }
  const attrs = readLiveHostAttributesMap(instance);
  if (options.domPaths && !attrs.has('data-lit-paths')) {
    attrs.set('data-lit-paths', 'true');
  }
  if (options.adoptKeys && options.adoptKeys.length > 0) {
    attrs.set('data-lit-adopt', options.adoptKeys.join(' '));
  }
  if (options.adoptedUrls && options.adoptedUrls.length > 0) {
    attrs.set('data-lit-adopted-urls', options.adoptedUrls.join(' '));
  }
  if (options.hostId !== undefined) {
    attrs.set('data-lit-ssr', String(options.hostId));
  }
  if (options.stateJson && !attrs.has('data-lit-state')) {
    attrs.set('data-lit-state', options.stateJson);
  }
  if (options.deferHydration && !attrs.has('defer-hydration')) {
    attrs.set('defer-hydration', '');
  }

  const eventAttrs = options.eventAttrs;
  if (attrs.size === 0 && (!eventAttrs || eventAttrs.length === 0)) {
    return '';
  }

  let out = '';
  for (const [k, v] of attrs.entries()) {
    out += v === '' ? ` ${k}` : ` ${k}="${escapeAttribute(v)}"`;
  }
  if (eventAttrs && eventAttrs.length > 0) {
    for (let i = 0; i < eventAttrs.length; i++) {
      const evAttr = eventAttrs[i];
      if (!attrs.has(evAttr)) {
        out += ` ${evAttr}`;
      }
    }
  }
  return out;
}

function shadowMayContainAsyncBoundary(value: unknown, context: SsrRenderContext, depth = 0): boolean {
  if (depth > 32 || value === null || value === undefined || typeof value !== 'object') {
    return false;
  }
  if (isNothing(value) || isTrustedRawHtml(value)) {
    return false;
  }
  if (isThenable(value) || isAsyncBoundaryDescriptor(value)) {
    return true;
  }
  if (typeof (value as any)[Symbol.asyncIterator] === 'function') {
    return true;
  }
  if (isElementInstance(value)) {
    return true;
  }
  if (typeof (value as any)._$litDirective$ === 'function') {
    const args: unknown[] = Array.isArray((value as any).values) ? (value as any).values : [];
    for (const arg of args) {
      if (typeof arg === 'function' || shadowMayContainAsyncBoundary(arg, context, depth + 1)) {
        return true;
      }
    }
    return false;
  }
  if (isCompiledTemplateResult(value)) {
    let plan = (value._$litType$ as any)?.ssrPlan || descriptorPlanCache.get(value._$litType$);
    if (!plan && !context.edge) {
      plan = compileLitDescriptorPlan(value._$litType$ as any);
      (value._$litType$ as any).ssrPlan = plan;
      descriptorPlanCache.set(value._$litType$, plan);
    }
    if (!plan || plan.v !== 2) {
      return true;
    }
    if (hasExpandableCustomElement(plan.opcodes, context.customElements, context.excludeElements)) {
      return true;
    }
    for (const item of value.values) {
      if (shadowMayContainAsyncBoundary(item, context, depth + 1)) {
        return true;
      }
    }
    return false;
  }
  if (isStandardTemplateResult(value)) {
    let plan = (value as any)._$litType$?.ssrPlan || templatePlanCache.get(value.strings);
    if (!plan && !context.edge) {
      plan = compileTemplatePlan(Array.from(value.strings));
      templatePlanCache.set(value.strings, plan);
    }
    if (!plan || plan.v !== 2) {
      return true;
    }
    if (hasExpandableCustomElement(plan.opcodes, context.customElements, context.excludeElements)) {
      return true;
    }
    const templateValues: unknown[] = Array.isArray((value as any).values) ? (value as any).values : [];
    for (const item of templateValues) {
      if (shadowMayContainAsyncBoundary(item, context, depth + 1)) {
        return true;
      }
    }
    return false;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (shadowMayContainAsyncBoundary(item, context, depth + 1)) {
        return true;
      }
    }
    return false;
  }
  if (Symbol.iterator in value && typeof (value as any)[Symbol.iterator] === 'function') {
    return true;
  }
  return false;
}

function* renderCustomElementWithOpcodeChildren(
  tagName: string,
  Ctor: new () => any,
  opcodes: SsrOpcode[],
  values: unknown[],
  start: number,
  end: number,
  context: SsrRenderContext,
  maxDepth: number,
  slotManager: SlotManager,
  staticAttrs?: Record<string, string>,
  dynamicAttrs?: SsrDynamicAttribute[],
): IterableIterator<string> {
  if (context.depth >= maxDepth) {
    throw new RangeError('Maximum SSR render depth exceeded');
  }
  const normalizedTag = tagName.toLowerCase();
  if (!isValidTagName(normalizedTag)) {
    throw new Error(`[@lit-core/ssr] Invalid custom element tag name '${tagName}'.`);
  }

  const instance = new Ctor();
  const isFlattened = context.mode !== 'dsd';
  const slotCtx = isFlattened ? slotManager.pushContext(normalizedTag) : null;
  const prevParentHost = context.parentHost;
  context.depth++;

  try {
    if (slotCtx) {
      distributeHostChildren(opcodes, values, start, end, slotCtx);
    }
    context.customElementRendered?.(normalizedTag);

    if (!isFlattened && context.asyncState && context.streamingMode !== 'in-order' && context.serverElementAdapter?.canHandle(Ctor, normalizedTag)) {
      const { eventAttrs: adapterEventAttrs } = prepareComponentBindings({
        instance,
        Ctor,
        tagName: normalizedTag,
        staticAttrs,
        dynamicAttrs,
        values,
        lightOpcodes: start < end ? { opcodes, values, start, end } : undefined,
        parentHost: prevParentHost,
        contextLookup: context.contextLookup,
        onError: context.onError,
        strictLifecycle: context.strictLifecycle,
        resumable: context.resumable,
      });
      const incomingAttrs = Object.fromEntries(readLiveHostAttributesMap(instance).entries());
      const hostId = context.asyncState.nextHostId++;
      const { templateOpenTag, styleTag, adoptKeys, adoptedUrls } = buildShadowStyleAndTemplateOpen(Ctor, context);
      const prepared = context.serverElementAdapter.prepareBoundary({
        instance,
        Ctor,
        tagName: normalizedTag,
        hostId,
        incomingAttrs,
        ssrContext: context,
      });
      prepared.boundaryPromise.catch(() => {});
      const nestedPath = [...context.asyncState.shadowPath, hostId];
      const boundaryId = context.asyncState.nextBoundaryId++;
      context.asyncState.boundaries.push({
        id: boundaryId,
        shadowPath: nestedPath,
        promise: prepared.boundaryPromise,
      });
      if (prepared.immediateHostAttributes) {
        for (const [k, v] of Object.entries(prepared.immediateHostAttributes)) {
          instance.setAttribute?.(k, v);
        }
      }
      const hostAttrStr = serializeHostAttributeString(instance, {
        eventAttrs: adapterEventAttrs,
        adoptKeys,
        adoptedUrls,
        hostId,
        domPaths: context.domPaths,
      });
      yield `<${normalizedTag}${hostAttrStr}>`;
      yield templateOpenTag;
      if (styleTag) yield styleTag;
      yield `<!--$b:${boundaryId}--><slot name="pending">`;
      if (prepared.pendingContent !== undefined) {
        context.asyncState.shadowPath.push(hostId);
        try {
          yield* renderInternal(prepared.pendingContent, context, maxDepth, slotManager);
        } finally {
          context.asyncState.shadowPath.pop();
        }
      }
      yield `</slot><!--/$b:${boundaryId}--></template>`;
      if (start < end) {
        yield* renderPlanV2Opcodes(opcodes, values, context, maxDepth, slotManager, start, end);
      }
      yield `</${normalizedTag}>`;
      return;
    }

    const effectiveDeferHydration = Boolean(context.deferHydration || ((context.litShadowDepth ?? 0) > 0 && context.hydratableScope !== false && !isServerElementClassOrInstance(Ctor, instance)));

    const { eventAttrs } = prepareAndRunComponentLifecycle({
      instance,
      Ctor,
      tagName: normalizedTag,
      staticAttrs,
      dynamicAttrs,
      values,
      lightOpcodes: start < end ? { opcodes, values, start, end } : undefined,
      parentHost: prevParentHost,
      contextLookup: context.contextLookup,
      onError: context.onError,
      strictLifecycle: context.strictLifecycle,
      resumable: context.resumable,
      deferHydration: effectiveDeferHydration,
      shouldCallConnectedCallback: context.shouldCallConnectedCallback,
      skipChangedTracking: true,
    });

    context.parentHost = instance;

    if (!componentHasShadowRoot(instance, Ctor)) {
      const stateJson = context.resumable ? context.compilerBridge.serializeComponentState(instance, context) : '';
      const hostAttrStr = serializeHostAttributeString(instance, {
        eventAttrs,
        stateJson,
        domPaths: context.domPaths,
        deferHydration: effectiveDeferHydration,
      });
      yield `<${normalizedTag}${hostAttrStr}>`;
      if (typeof instance.render === 'function') {
        const lightRenderResult = instance.render();
        yield* renderShadowBodyWithAsyncTracking(instance, lightRenderResult, context, maxDepth, slotManager, false);
      }
      if (start < end) {
        yield* renderPlanV2Opcodes(opcodes, values, context, maxDepth, slotManager, start, end);
      }
      yield `</${normalizedTag}>`;
      return;
    }

    const { templateOpenTag, styleTag, adoptKeys, adoptedUrls } = buildShadowStyleAndTemplateOpen(Ctor, context);
    const shadowResult = instance.render?.();
    const stateJson = context.resumable ? context.compilerBridge.serializeComponentState(instance, context) : '';

    if (!isFlattened) {
      if (context.asyncState && context.streamingMode !== 'in-order' && shadowMayContainAsyncBoundary(shadowResult, context)) {
        const hostId = context.asyncState.nextHostId++;
        const hostAttrStr = serializeHostAttributeString(instance, {
          eventAttrs,
          adoptKeys,
          adoptedUrls,
          hostId,
          stateJson,
          domPaths: context.domPaths,
          deferHydration: effectiveDeferHydration,
        });

        // Stream host open tag immediately without buffering shadow subtrees
        yield `<${normalizedTag}${hostAttrStr}>`;
        yield templateOpenTag;
        if (styleTag) yield styleTag;
        context.asyncState.shadowPath.push(hostId);
        try {
          yield* renderShadowBodyWithAsyncTracking(instance, shadowResult, context, maxDepth, slotManager, true);
        } finally {
          context.asyncState.shadowPath.pop();
        }
        yield '</template>';
      } else {
        const hostAttrStr = serializeHostAttributeString(instance, {
          eventAttrs,
          adoptKeys,
          adoptedUrls,
          stateJson,
          domPaths: context.domPaths,
          deferHydration: effectiveDeferHydration,
        });
        yield `<${normalizedTag}${hostAttrStr}>`;
        yield templateOpenTag;
        if (styleTag) yield styleTag;
        yield* renderShadowBodyWithAsyncTracking(instance, shadowResult, context, maxDepth, slotManager, true);
        yield '</template>';
      }

      if (start < end) {
        yield* renderPlanV2Opcodes(opcodes, values, context, maxDepth, slotManager, start, end);
      }

      yield `</${normalizedTag}>`;
    } else {
      const hostAttrStr = serializeHostAttributeString(instance, {
        eventAttrs,
        domPaths: context.domPaths,
        deferHydration: effectiveDeferHydration,
      });
      yield `<${normalizedTag}${hostAttrStr}>`;
      yield* renderShadowBodyWithAsyncTracking(instance, shadowResult, context, maxDepth, slotManager, false);
      yield `</${normalizedTag}>`;
    }
  } finally {
    context.parentHost = prevParentHost;
    context.depth--;
    if (slotCtx) {
      slotManager.popContext();
    }
  }
}

function hasExistingDeclarativeShadowRoot(opcodes: SsrOpcode[], start: number, end: number): boolean {
  for (let idx = start; idx < end; idx++) {
    const child = opcodes[idx];
    if (child.type === 'text' && child.value.trim().length === 0) continue;
    if (child.type === 'comment') continue;
    if (child.type === 'open') {
      return Boolean(child.tag === 'template' && child.staticAttrs && (Object.hasOwn(child.staticAttrs, 'shadowrootmode') || Object.hasOwn(child.staticAttrs, 'shadowroot')));
    }
    return false;
  }
  return false;
}

function renderStaticAttrsToString(staticAttrs?: Record<string, string>): string {
  if (!staticAttrs) return '';
  let out = '';
  for (const [k, v] of Object.entries(staticAttrs)) {
    out += ` ${k}="${escapeAttribute(v)}"`;
  }
  return out;
}

function renderDynamicAttrsToString(dynamicAttrs: readonly SsrDynamicAttribute[], tagUpper: string, values: unknown[], resumable: boolean): string {
  let renderedAttrs = '';
  for (let dIdx = 0; dIdx < dynamicAttrs.length; dIdx++) {
    const dyn = dynamicAttrs[dIdx];
    if (dyn.type === 'attribute') {
      const attrName = dyn.name;
      if (dyn.indices && dyn.strings) {
        let formatted = dyn.strings[0] ?? '';
        for (let j = 0; j < dyn.indices.length; j++) {
          const idx = dyn.indices[j];
          const rawVal = idx < values.length ? values[idx] : undefined;
          const resolved = resolveDirectiveValue(rawVal, { type: 1, tagName: tagUpper, name: attrName, strings: dyn.strings });
          formatted += !isNothing(resolved) && resolved !== null && resolved !== undefined ? String(resolved) : '';
          formatted += dyn.strings[j + 1] ?? '';
        }
        renderedAttrs += ` ${attrName}="${escapeAttribute(formatted)}"`;
      } else {
        const rawVal = dyn.index < values.length ? values[dyn.index] : undefined;
        const resolved = resolveDirectiveValue(rawVal, { type: 1, tagName: tagUpper, name: attrName, strings: dyn.strings });
        if (!isNothing(resolved) && resolved !== null && resolved !== undefined) {
          const formatted = dyn.strings && dyn.strings.length > 1 ? dyn.strings[0] + String(resolved) + dyn.strings.slice(1).join('') : String(resolved);
          renderedAttrs += ` ${attrName}="${escapeAttribute(formatted)}"`;
        }
      }
    } else if (dyn.type === 'property') {
      const reflectedName = reflectedAttributeName(tagUpper, dyn.name);
      if (dyn.indices && dyn.strings) {
        let formatted = dyn.strings[0] ?? '';
        let omitted = false;
        for (let j = 0; j < dyn.indices.length; j++) {
          const idx = dyn.indices[j];
          const rawVal = idx < values.length ? values[idx] : undefined;
          const resolved = resolveDirectiveValue(rawVal, { type: 3, tagName: tagUpper, name: dyn.name, strings: dyn.strings });
          if (isNothing(resolved)) {
            omitted = true;
          } else if (resolved !== null && resolved !== undefined) {
            formatted += String(resolved);
          }
          formatted += dyn.strings[j + 1] ?? '';
        }
        if (reflectedName !== undefined && !omitted) {
          renderedAttrs += ` ${reflectedName}="${escapeAttribute(formatted)}"`;
        }
      } else {
        const rawVal = dyn.index < values.length ? values[dyn.index] : undefined;
        const resolved = resolveDirectiveValue(rawVal, { type: 3, tagName: tagUpper, name: dyn.name, strings: dyn.strings });
        if (reflectedName !== undefined && !isNothing(resolved)) {
          const formatted =
            dyn.strings && dyn.strings.length > 1
              ? dyn.strings[0] + (resolved !== null && resolved !== undefined ? String(resolved) : '') + dyn.strings.slice(1).join('')
              : typeof resolved === 'string'
                ? resolved
                : String(resolved);
          renderedAttrs += ` ${reflectedName}="${escapeAttribute(formatted)}"`;
        }
      }
    } else if (dyn.type === 'boolean') {
      const rawVal = dyn.index < values.length ? values[dyn.index] : undefined;
      const resolved = resolveDirectiveValue(rawVal, { type: 4, tagName: tagUpper, name: dyn.name });
      if (resolved && !isNothing(resolved)) {
        renderedAttrs += ` ${dyn.name}`;
      }
    } else if (dyn.type === 'event') {
      if (resumable) {
        renderedAttrs += ` resumes-on-${dyn.name}`;
      }
    }
    // ElementPart (`dyn.type === 'directive'`) only executes `update()` on live client DOM elements.
  }
  return renderedAttrs;
}

function* emitMarkerStart(op: { name: string }): IterableIterator<string> {
  yield `<?start name="${op.name}">`;
}

type CompiledDsdStep =
  | { kind: 'html'; html: string }
  | { kind: 'part'; index: number }
  | { kind: 'marker-start'; op: { name: string } }
  | {
      kind: 'dynamic-open';
      openPrefix: string;
      tagUpper: string;
      dynamicAttrs: SsrDynamicAttribute[];
      closeToken: string;
    }
  | {
      kind: 'custom-open';
      tag: string;
      tagLower: string;
      tagUpper: string;
      openPrefix: string;
      closeToken: string;
      staticAttrs?: Record<string, string>;
      dynamicAttrs?: SsrDynamicAttribute[];
      childStart: number;
      childEnd: number;
      hasExistingDsd: boolean;
      nextOpcode: number;
      jumpStepIndex: number;
    };

interface CompiledDsdPlan {
  steps: CompiledDsdStep[];
  hasMarkerStart: boolean;
}

const compiledDsdStepsCache = new WeakMap<SsrOpcode[], CompiledDsdPlan>();

function compileDsdSteps(opcodes: SsrOpcode[]): CompiledDsdPlan {
  const cached = compiledDsdStepsCache.get(opcodes);
  if (cached !== undefined) {
    return cached;
  }

  const len = opcodes.length;
  const jumpTargets = new Set<number>();
  const customMetaByIdx = new Map<number, { childStart: number; childEnd: number; nextOpcode: number; hasExistingDsd: boolean }>();

  for (let i = 0; i < len; i++) {
    const op = opcodes[i];
    if (op.type === 'open' && op.isCustomElement) {
      const closeTagIndex = findMatchingCloseTag(opcodes, i, len);
      const childStart = i + 1;
      const childEnd = op.isVoid || op.isSelfClosing || closeTagIndex === i ? i + 1 : closeTagIndex;
      const nextOpcode = closeTagIndex > i ? closeTagIndex + 1 : i + 1;
      const hasExistingDsd = hasExistingDeclarativeShadowRoot(opcodes, childStart, childEnd);
      customMetaByIdx.set(i, { childStart, childEnd, nextOpcode, hasExistingDsd });
      jumpTargets.add(nextOpcode);
    }
  }

  const steps: CompiledDsdStep[] = [];
  const opcodeToStepIndex = new Map<number, number>();
  let htmlBuf = '';
  let hasMarkerStart = false;

  const flushHtml = () => {
    if (htmlBuf.length > 0) {
      steps.push({ kind: 'html', html: htmlBuf });
      htmlBuf = '';
    }
  };

  for (let i = 0; i < len; i++) {
    if (jumpTargets.has(i)) {
      flushHtml();
      opcodeToStepIndex.set(i, steps.length);
    }
    const op = opcodes[i];
    switch (op.type) {
      case 'open': {
        const staticAttrStr = renderStaticAttrsToString(op.staticAttrs);
        const closeToken = op.isSelfClosing ? '/>' : '>';
        if (op.isCustomElement) {
          flushHtml();
          const cMeta = customMetaByIdx.get(i)!;
          steps.push({
            kind: 'custom-open',
            tag: op.tag,
            tagLower: op.tag.toLowerCase(),
            tagUpper: op.tag.toUpperCase(),
            openPrefix: `<${op.tag}${staticAttrStr}`,
            closeToken,
            staticAttrs: op.staticAttrs,
            dynamicAttrs: op.dynamicAttrs,
            childStart: cMeta.childStart,
            childEnd: cMeta.childEnd,
            hasExistingDsd: cMeta.hasExistingDsd,
            nextOpcode: cMeta.nextOpcode,
            jumpStepIndex: 0,
          });
        } else if (op.dynamicAttrs && op.dynamicAttrs.length > 0) {
          flushHtml();
          steps.push({
            kind: 'dynamic-open',
            openPrefix: `<${op.tag}${staticAttrStr}`,
            tagUpper: op.tag.toUpperCase(),
            dynamicAttrs: op.dynamicAttrs,
            closeToken,
          });
        } else {
          htmlBuf += `<${op.tag}${staticAttrStr}${closeToken}`;
        }
        break;
      }
      case 'close': {
        htmlBuf += `</${op.tag}>`;
        break;
      }
      case 'text': {
        if (op.value.length > 0) {
          htmlBuf += op.value;
        }
        break;
      }
      case 'comment': {
        htmlBuf += `<!--${op.value}-->`;
        break;
      }
      case 'marker-end': {
        htmlBuf += '<?end>';
        break;
      }
      case 'marker-start': {
        flushHtml();
        hasMarkerStart = true;
        steps.push({ kind: 'marker-start', op });
        break;
      }
      case 'part': {
        flushHtml();
        steps.push({ kind: 'part', index: op.index });
        break;
      }
    }
  }

  flushHtml();
  opcodeToStepIndex.set(len, steps.length);

  for (let s = 0; s < steps.length; s++) {
    const step = steps[s];
    if (step.kind === 'custom-open') {
      step.jumpStepIndex = opcodeToStepIndex.get(step.nextOpcode) ?? steps.length;
    }
  }

  const compiled: CompiledDsdPlan = { steps, hasMarkerStart };
  compiledDsdStepsCache.set(opcodes, compiled);
  return compiled;
}

function renderSyncDsdValueToString(val: unknown, context: SsrRenderContext, maxDepth: number, slotManager: SlotManager): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.length > 0 ? escapeHtml(val) : '';
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') return String(val);
  if (typeof val === 'symbol') return '';

  if (context.depth > maxDepth) {
    throw new RangeError('Maximum SSR render depth exceeded');
  }

  if (isCompiledTemplateResult(val)) {
    let plan = (val._$litType$ as any)?.ssrPlan || descriptorPlanCache.get(val._$litType$);
    if (!plan) {
      if (context.edge) {
        throw new Error('[@lit-core/ssr] Uncompiled Lit template encountered in edge mode. Templates must be compiled ahead of time via @lit-core/html-aot or bundler plugins.');
      }
      plan = compileLitDescriptorPlan(val._$litType$ as any);
      (val._$litType$ as any).ssrPlan = plan;
      descriptorPlanCache.set(val._$litType$, plan);
    }
    const compiled = compileDsdSteps(plan.opcodes);
    const prevHydratable = context.hydratableScope;
    context.hydratableScope = (val as any)._$litServerRenderMode !== 1;
    context.depth++;
    try {
      return renderCompiledDsdStepsToString(compiled.steps, plan.opcodes, val.values, context, maxDepth, slotManager);
    } finally {
      context.depth--;
      context.hydratableScope = prevHydratable;
    }
  } else if (isStandardTemplateResult(val) && !context.edge) {
    let plan = (val as any)._$litType$?.ssrPlan || templatePlanCache.get(val.strings);
    if (!plan) {
      plan = compileTemplatePlan(Array.from(val.strings));
      templatePlanCache.set(val.strings, plan);
    }
    const compiled = compileDsdSteps(plan.opcodes);
    const templateValues = (val as any).values || [];
    const prevHydratable = context.hydratableScope;
    context.hydratableScope = (val as any)._$litServerRenderMode !== 1;
    context.depth++;
    try {
      return renderCompiledDsdStepsToString(compiled.steps, plan.opcodes, templateValues, context, maxDepth, slotManager);
    } finally {
      context.depth--;
      context.hydratableScope = prevHydratable;
    }
  } else if (Array.isArray(val)) {
    context.depth++;
    try {
      let arrOut = '';
      for (let i = 0; i < val.length; i++) {
        arrOut += renderSyncDsdValueToString(val[i], context, maxDepth, slotManager);
      }
      return arrOut;
    } finally {
      context.depth--;
    }
  }

  let fallbackOut = '';
  for (const chunk of renderInternal(val, context, maxDepth, slotManager)) {
    fallbackOut += chunk;
  }
  return fallbackOut;
}

function renderSyncCustomElementToString(
  tagName: string,
  normalizedTag: string,
  tagUpper: string,
  Ctor: new () => any,
  opcodes: SsrOpcode[],
  values: unknown[],
  start: number,
  end: number,
  context: SsrRenderContext,
  maxDepth: number,
  slotManager: SlotManager,
  staticAttrs?: Record<string, string>,
  dynamicAttrs?: SsrDynamicAttribute[],
): string {
  if (context.depth >= maxDepth) {
    throw new RangeError('Maximum SSR render depth exceeded');
  }
  if (!isValidTagName(normalizedTag)) {
    throw new Error(`[@lit-core/ssr] Invalid custom element tag name '${tagName}'.`);
  }

  const meta = getCtorSsrMeta(Ctor);
  const instance = new Ctor();
  const prevParentHost = context.parentHost;
  context.depth++;

  try {
    context.customElementRendered?.(normalizedTag);
    const isServerInstance = meta.isServerElementCtor || Boolean(instance?.[SERVER_ELEMENT_SYMBOL]);
    const effectiveDeferHydration = Boolean(context.deferHydration || ((context.litShadowDepth ?? 0) > 0 && context.hydratableScope !== false && !isServerInstance));

    const canInlineZeroAttrFastPath =
      meta.canFastPathLifecycle &&
      instance instanceof HTMLElementStub &&
      !staticAttrs &&
      (!dynamicAttrs || dynamicAttrs.length === 0) &&
      start >= end &&
      !context.shouldCallConnectedCallback &&
      !(instance as any)._$EO?.size &&
      !(instance as any).__controllers?.size &&
      !(instance as any)._controllers?.size &&
      !(instance as any).__internals &&
      !Object.hasOwn(instance, 'connectedCallback') &&
      !Object.hasOwn(instance, 'willUpdate');

    let eventAttrs: string[] = EMPTY_EVENT_ATTRS;
    if (canInlineZeroAttrFastPath) {
      instance.tagName = tagUpper;
      instance.isConnected = true;
      if (meta.accessorProps.length > 0) {
        repairShadowedClassFields(instance, meta.accessorProps);
      }
      instance._ssrParentHost = prevParentHost ?? null;
      if (context.contextLookup) {
        instance._ssrContextLookup = context.contextLookup;
      }
      (instance as any).isUpdatePending = false;
    } else {
      eventAttrs = prepareAndRunComponentLifecycle({
        instance,
        Ctor,
        tagName: normalizedTag,
        staticAttrs,
        dynamicAttrs,
        values,
        lightOpcodes: start < end ? { opcodes, values, start, end } : undefined,
        parentHost: prevParentHost,
        contextLookup: context.contextLookup,
        onError: context.onError,
        strictLifecycle: context.strictLifecycle,
        resumable: context.resumable,
        deferHydration: effectiveDeferHydration,
        shouldCallConnectedCallback: context.shouldCallConnectedCallback,
        skipChangedTracking: true,
      }).eventAttrs;
    }

    context.parentHost = instance;

    if (!canInlineZeroAttrFastPath && !componentHasShadowRoot(instance, Ctor)) {
      const stateJson = context.resumable ? context.compilerBridge.serializeComponentState(instance, context) : '';
      const hostAttrStr = serializeHostAttributeString(instance, {
        eventAttrs,
        stateJson,
        domPaths: context.domPaths,
        deferHydration: effectiveDeferHydration,
      });
      let out = `<${normalizedTag}${hostAttrStr}>`;
      if (typeof instance.render === 'function') {
        out += renderSyncDsdValueToString(instance.render(), context, maxDepth, slotManager);
      }
      if (start < end) {
        for (const chunk of renderPlanV2Opcodes(opcodes, values, context, maxDepth, slotManager, start, end)) {
          out += chunk;
        }
      }
      out += `</${normalizedTag}>`;
      return out;
    }

    let shadowPrefix: string;
    let hostAttrStr: string;
    if (!context.cssFuse && !context.nonce && !context.adoptedStyleSheets?.urlResolver) {
      shadowPrefix = meta.plainNoCssFuseShadowPrefix;
      const stateJson = context.resumable ? context.compilerBridge.serializeComponentState(instance, context) : '';
      if (instance instanceof HTMLElementStub && !instance._getRawAttributesMap()?.size && !context.domPaths && !stateJson && eventAttrs.length === 0) {
        hostAttrStr = effectiveDeferHydration ? ' defer-hydration' : '';
      } else {
        hostAttrStr = serializeHostAttributeString(instance, {
          eventAttrs,
          stateJson,
          domPaths: context.domPaths,
          deferHydration: effectiveDeferHydration,
        });
      }
    } else {
      const { templateOpenTag, styleTag, adoptKeys, adoptedUrls } = buildShadowStyleAndTemplateOpen(Ctor, context);
      shadowPrefix = `${templateOpenTag}${styleTag}`;
      const stateJson = context.resumable ? context.compilerBridge.serializeComponentState(instance, context) : '';
      hostAttrStr = serializeHostAttributeString(instance, {
        eventAttrs,
        adoptKeys,
        adoptedUrls,
        stateJson,
        domPaths: context.domPaths,
        deferHydration: effectiveDeferHydration,
      });
    }

    const shadowResult = instance.render?.();
    let out = `<${normalizedTag}${hostAttrStr}>${shadowPrefix}`;
    if (!isThenable(shadowResult) && shadowResult !== undefined && shadowResult !== null) {
      const incrementLitShadow = meta.isHydratableLitHost && !isServerInstance;
      if (incrementLitShadow) {
        context.litShadowDepth = (context.litShadowDepth ?? 0) + 1;
      }
      try {
        out += renderSyncDsdValueToString(shadowResult, context, maxDepth, slotManager);
      } finally {
        if (incrementLitShadow) {
          context.litShadowDepth = Math.max(0, (context.litShadowDepth ?? 1) - 1);
        }
      }
    } else if (isThenable(shadowResult)) {
      Promise.resolve(shadowResult).catch(() => {});
      if (typeof instance.renderPending === 'function') {
        out += renderSyncDsdValueToString(instance.renderPending(), context, maxDepth, slotManager);
      }
    }
    out += '</template>';

    if (start < end) {
      for (const chunk of renderPlanV2Opcodes(opcodes, values, context, maxDepth, slotManager, start, end)) {
        out += chunk;
      }
    }

    out += `</${normalizedTag}>`;
    return out;
  } finally {
    context.parentHost = prevParentHost;
    context.depth--;
  }
}

function renderCompiledDsdStepsToString(steps: CompiledDsdStep[], opcodes: SsrOpcode[], values: unknown[], context: SsrRenderContext, maxDepth: number, slotManager: SlotManager): string {
  let out = '';
  let sIdx = 0;
  const sLen = steps.length;
  while (sIdx < sLen) {
    const step = steps[sIdx];
    switch (step.kind) {
      case 'html': {
        out += step.html;
        sIdx++;
        break;
      }
      case 'part': {
        const rawVal = step.index < values.length ? values[step.index] : undefined;
        out += renderSyncDsdValueToString(rawVal, context, maxDepth, slotManager);
        sIdx++;
        break;
      }
      case 'dynamic-open': {
        const dynStr = renderDynamicAttrsToString(step.dynamicAttrs, step.tagUpper, values, context.resumable);
        out += `${step.openPrefix}${dynStr}${step.closeToken}`;
        sIdx++;
        break;
      }
      case 'custom-open': {
        const Ctor = !step.hasExistingDsd && !isElementExcluded(step.tagLower, context.excludeElements) ? context.customElements?.get(step.tag) : undefined;
        if (Ctor) {
          out += renderSyncCustomElementToString(
            step.tag,
            step.tagLower,
            step.tagUpper,
            Ctor,
            opcodes,
            values,
            step.childStart,
            step.childEnd,
            context,
            maxDepth,
            slotManager,
            step.staticAttrs,
            step.dynamicAttrs,
          );
          sIdx = step.jumpStepIndex;
        } else {
          const dynStr = step.dynamicAttrs ? renderDynamicAttrsToString(step.dynamicAttrs, step.tagUpper, values, context.resumable) : '';
          out += `${step.openPrefix}${dynStr}${step.closeToken}`;
          sIdx++;
        }
        break;
      }
      case 'marker-start': {
        for (const chunk of emitMarkerStart(step.op)) {
          out += chunk;
        }
        sIdx++;
        break;
      }
    }
  }
  return out;
}

function* renderCompiledDsdSteps(steps: CompiledDsdStep[], opcodes: SsrOpcode[], values: unknown[], context: SsrRenderContext, maxDepth: number, slotManager: SlotManager): IterableIterator<string> {
  let sIdx = 0;
  const sLen = steps.length;
  while (sIdx < sLen) {
    const step = steps[sIdx];
    switch (step.kind) {
      case 'html': {
        yield step.html;
        sIdx++;
        break;
      }
      case 'part': {
        const rawVal = step.index < values.length ? values[step.index] : undefined;
        if (rawVal === null || rawVal === undefined) {
          // Fast skip null / undefined
        } else if (typeof rawVal === 'string') {
          if (rawVal.length > 0) {
            yield escapeHtml(rawVal);
          }
        } else if (typeof rawVal === 'number' || typeof rawVal === 'boolean' || typeof rawVal === 'bigint') {
          yield String(rawVal);
        } else {
          yield* renderInternal(rawVal, context, maxDepth, slotManager);
        }
        sIdx++;
        break;
      }
      case 'dynamic-open': {
        const dynStr = renderDynamicAttrsToString(step.dynamicAttrs, step.tagUpper, values, context.resumable);
        yield `${step.openPrefix}${dynStr}${step.closeToken}`;
        sIdx++;
        break;
      }
      case 'custom-open': {
        const Ctor = !step.hasExistingDsd && !isElementExcluded(step.tagLower, context.excludeElements) ? context.customElements?.get(step.tag) : undefined;
        if (Ctor) {
          yield* renderCustomElementWithOpcodeChildren(step.tag, Ctor, opcodes, values, step.childStart, step.childEnd, context, maxDepth, slotManager, step.staticAttrs, step.dynamicAttrs);
          sIdx = step.jumpStepIndex;
        } else {
          const dynStr = step.dynamicAttrs ? renderDynamicAttrsToString(step.dynamicAttrs, step.tagUpper, values, context.resumable) : '';
          yield `${step.openPrefix}${dynStr}${step.closeToken}`;
          sIdx++;
        }
        break;
      }
      case 'marker-start': {
        yield* emitMarkerStart(step.op);
        sIdx++;
        break;
      }
    }
  }
}

function* renderPlanV2Opcodes(
  opcodes: SsrOpcode[],
  values: unknown[],
  context: SsrRenderContext,
  maxDepth: number,
  slotManager: SlotManager,
  start = 0,
  end = opcodes.length,
): IterableIterator<string> {
  if (context.mode === 'dsd' && start === 0 && end === opcodes.length) {
    const compiled = compileDsdSteps(opcodes);
    if (!context.asyncState) {
      const rendered = renderCompiledDsdStepsToString(compiled.steps, opcodes, values, context, maxDepth, slotManager);
      if (rendered.length > 0) {
        yield rendered;
      }
      return;
    }
    yield* renderCompiledDsdSteps(compiled.steps, opcodes, values, context, maxDepth, slotManager);
    return;
  }

  let i = start;
  while (i < end) {
    const op = opcodes[i];
    switch (op.type) {
      case 'open': {
        const Ctor = op.isCustomElement && !isElementExcluded(op.tag.toLowerCase(), context.excludeElements) ? context.customElements?.get(op.tag) : undefined;
        const closeTagIndex = findMatchingCloseTag(opcodes, i, end);

        if (Ctor && closeTagIndex >= i) {
          const childStart = i + 1;
          const childEnd = op.isVoid || op.isSelfClosing || closeTagIndex === i ? i + 1 : closeTagIndex;
          if (!hasExistingDeclarativeShadowRoot(opcodes, childStart, childEnd)) {
            yield* renderCustomElementWithOpcodeChildren(op.tag, Ctor, opcodes, values, childStart, childEnd, context, maxDepth, slotManager, op.staticAttrs, op.dynamicAttrs);
            i = closeTagIndex > i ? closeTagIndex + 1 : i + 1;
            continue;
          }
        }

        let renderedAttrs = renderStaticAttrsToString(op.staticAttrs);
        if (op.dynamicAttrs) {
          renderedAttrs += renderDynamicAttrsToString(op.dynamicAttrs, op.tag.toUpperCase(), values, context.resumable);
        }

        if (op.tag === 'slot' && context.mode === 'flattened') {
          let slotName = '';
          if (op.staticAttrs && 'name' in op.staticAttrs) {
            slotName = (op.staticAttrs.name || '').trim();
          } else if (op.dynamicAttrs) {
            const dynName = op.dynamicAttrs.find((d) => d.type === 'attribute' && d.name === 'name');
            if (dynName) {
              const raw = dynName.index < values.length ? values[dynName.index] : undefined;
              if (raw !== null && raw !== undefined) {
                slotName = String(raw).trim();
              }
            }
          }

          const currentCtx = slotManager.currentContext;
          if (currentCtx?.hasAssignedNodes(slotName)) {
            const assigned = currentCtx.getAssignedNodes(slotName);
            for (const node of assigned) {
              if (node.opcodes && node.startIndex !== undefined && node.endIndex !== undefined) {
                yield* renderPlanV2Opcodes(node.opcodes, node.values ?? values, context, maxDepth, slotManager, node.startIndex, node.endIndex);
              } else if (node.content !== undefined) {
                if (typeof node.content === 'string') {
                  yield node.content;
                } else {
                  yield* renderInternal(node.content, context, maxDepth, slotManager);
                }
              }
            }
          } else if (closeTagIndex > i + 1) {
            yield* renderPlanV2Opcodes(opcodes, values, context, maxDepth, slotManager, i + 1, closeTagIndex);
          }

          i = closeTagIndex > i ? closeTagIndex + 1 : i + 1;
          continue;
        }

        const closeToken = op.isSelfClosing ? '/>' : '>';
        yield `<${op.tag}${renderedAttrs}${closeToken}`;
        break;
      }
      case 'close': {
        yield `</${op.tag}>`;
        break;
      }
      case 'text': {
        if (op.value.length > 0) {
          yield op.value;
        }
        break;
      }
      case 'comment': {
        yield `<!--${op.value}-->`;
        break;
      }
      case 'part': {
        const rawVal = op.index < values.length ? values[op.index] : undefined;
        yield* renderInternal(rawVal, context, maxDepth, slotManager);
        break;
      }
      case 'marker-start': {
        yield* emitMarkerStart(op);
        break;
      }
      case 'marker-end': {
        yield `<?end>`;
        break;
      }
    }
    i++;
  }
}

function defineElementProperty(target: any, prop: string, value: any): void {
  try {
    target[prop] = value;
  } catch {
    try {
      Object.defineProperty(target, prop, {
        value,
        configurable: true,
        writable: true,
        enumerable: true,
      });
    } catch {
      // Ignore if property is locked
    }
  }
}

export function buildShadowStyleAndTemplateOpen(Ctor: any, context: SsrRenderContext): { templateOpenTag: string; styleTag: string; adoptKeys: string[]; adoptedUrls: string[] } {
  const urlResolver = context.adoptedStyleSheets?.urlResolver;
  if (!context.nonce && !urlResolver) {
    const meta = Ctor ? getCtorSsrMeta(Ctor) : null;
    const { styleTag, adoptKeys } = context.styleDeduplicator.resolveDefaultStyleTag(Ctor, context.cssFuse);
    return {
      templateOpenTag: meta ? meta.defaultTemplateOpenTag : '<template shadowrootmode="open">',
      styleTag,
      adoptKeys,
      adoptedUrls: EMPTY_ADOPTED_URLS,
    };
  }

  const nonceAttr = context.nonce ? ` nonce="${escapeAttribute(context.nonce)}"` : '';
  const shadowOpts = Ctor?.shadowRootOptions;
  const shadowMode = shadowOpts?.mode === 'closed' ? 'closed' : 'open';
  const delegatesAttr = shadowOpts?.delegatesFocus ? ' shadowrootdelegatesfocus' : '';

  if (urlResolver && context.cssFuse) {
    const { local: localStyles, sharedEntries } = context.compilerBridge.extractComponentStyles(Ctor);
    if (sharedEntries.length > 0) {
      const urls: string[] = [];
      for (const entry of sharedEntries) {
        const url = urlResolver(entry.key, entry.css);
        urls.push(url);
        context.styleDeduplicator.recordAdoptedUrlSheet(url, entry.css);
      }
      const escapedUrls = urls.map((u) => escapeAttribute(u));
      const adoptedAttr = ` shadowrootadoptedstylesheets="${escapedUrls.join(' ')}"`;
      const styleTag = localStyles.length > 0 ? `<style data-lit-local${nonceAttr}>${localStyles.join('\n')}</style>` : '';
      return {
        templateOpenTag: `<template shadowrootmode="${shadowMode}"${delegatesAttr}${adoptedAttr}>`,
        styleTag,
        adoptKeys: [],
        adoptedUrls: urls,
      };
    }
  }

  const resolved = context.styleDeduplicator.resolveComponentStyles(Ctor, context.cssFuse);
  let styleTag = '';

  // Emit first-occurrence shared sheets in exact declaration order before local overrides (Invariant #1)
  for (const entry of resolved.firstTimeShared) {
    styleTag += `<style data-lit-sheet="${escapeAttribute(entry.key)}"${nonceAttr}>${entry.css}</style>`;
  }

  if (resolved.localStyles.length > 0) {
    const localAttr = resolved.adoptedSharedKeys.length > 0 ? ' data-lit-local' : '';
    styleTag += `<style${localAttr}${nonceAttr}>${resolved.localStyles.join('\n')}</style>`;
  }

  return {
    templateOpenTag: `<template shadowrootmode="${shadowMode}"${delegatesAttr}>`,
    styleTag,
    adoptKeys: resolved.adoptedSharedKeys,
    adoptedUrls: [],
  };
}

const SERVER_ELEMENT_SYMBOL = Symbol.for('@lit-core/server-elements/element');
const SERVER_LOADER_SYMBOL = Symbol.for('@lit-core/server-elements/loader');
const SERVER_ACTION_SYMBOL = Symbol.for('@lit-core/server-elements/action');

function isServerElementClassOrInstance(Ctor: any, instance?: any): boolean {
  return Boolean(instance?.[SERVER_ELEMENT_SYMBOL] || Ctor?.[SERVER_ELEMENT_SYMBOL] || Ctor?.[SERVER_LOADER_SYMBOL] || Ctor?.[SERVER_ACTION_SYMBOL]);
}

function isClientHydratableLitHost(Ctor: any, instance?: any): boolean {
  return Boolean(Ctor?._$litElement$) && !isServerElementClassOrInstance(Ctor, instance);
}

function* renderShadowBodyWithAsyncTracking(
  instance: any,
  shadowResult: unknown,
  context: SsrRenderContext,
  maxDepth: number,
  slotManager: SlotManager,
  isShadowRoot = true,
): IterableIterator<string> {
  const incrementLitShadow = isShadowRoot && isClientHydratableLitHost(instance?.constructor, instance);
  if (incrementLitShadow) {
    context.litShadowDepth = (context.litShadowDepth ?? 0) + 1;
  }
  try {
    if (isThenable(shadowResult)) {
      const p = Promise.resolve(shadowResult);
      p.catch(() => {});
      if (context.asyncState && context.mode === 'dsd') {
        const boundaryId = context.asyncState.nextBoundaryId++;
        context.asyncState.boundaries.push({
          id: boundaryId,
          shadowPath: [...context.asyncState.shadowPath],
          promise: p,
        });
        yield `<!--$b:${boundaryId}-->`;
        if (typeof instance.renderPending === 'function') {
          yield* renderInternal(instance.renderPending(), context, maxDepth, slotManager);
        } else {
          yield '<slot name="pending"></slot>';
        }
        yield `<!--/$b:${boundaryId}-->`;
      } else if (typeof instance.renderPending === 'function') {
        yield* renderInternal(instance.renderPending(), context, maxDepth, slotManager);
      }
      return;
    }

    if (shadowResult !== undefined && shadowResult !== null) {
      yield* renderInternal(shadowResult, context, maxDepth, slotManager);
    }
  } finally {
    if (incrementLitShadow) {
      context.litShadowDepth = Math.max(0, (context.litShadowDepth ?? 1) - 1);
    }
  }
}

function* renderComponentInstance(instance: HTMLElementStub, context: SsrRenderContext, maxDepth: number, slotManager: SlotManager): IterableIterator<string> {
  const ctor = instance.constructor;
  const tagName = (instance.tagName ? instance.tagName.toLowerCase() : (ctor as any).is || 'custom-element').toLowerCase();
  if (!isValidTagName(tagName)) {
    throw new Error(`[@lit-core/ssr] Invalid custom element tag name '${tagName}'.`);
  }

  if (isElementExcluded(tagName, context.excludeElements)) {
    const hostAttrStr = serializeHostAttributeString(instance, {
      domPaths: context.domPaths,
    });
    yield `<${tagName}${hostAttrStr}></${tagName}>`;
    return;
  }

  context.customElementRendered?.(tagName);
  const prevParentHost = context.parentHost;
  const effectiveDeferHydration = Boolean(context.deferHydration || ((context.litShadowDepth ?? 0) > 0 && context.hydratableScope !== false && !isServerElementClassOrInstance(ctor, instance)));
  prepareAndRunComponentLifecycle({
    instance,
    Ctor: ctor,
    tagName,
    parentHost: prevParentHost,
    contextLookup: context.contextLookup,
    onError: context.onError,
    strictLifecycle: context.strictLifecycle,
    resumable: context.resumable,
    deferHydration: effectiveDeferHydration,
    shouldCallConnectedCallback: context.shouldCallConnectedCallback,
  });
  context.parentHost = instance;

  if (!componentHasShadowRoot(instance, ctor)) {
    const stateJson = context.resumable ? context.compilerBridge.serializeComponentState(instance, context) : '';
    const hostAttrStr = serializeHostAttributeString(instance, {
      stateJson,
      domPaths: context.domPaths,
      deferHydration: effectiveDeferHydration,
    });
    yield `<${tagName}${hostAttrStr}>`;
    if (typeof (instance as any).render === 'function') {
      slotManager.pushContext(tagName);
      try {
        yield* renderShadowBodyWithAsyncTracking(instance, (instance as any).render(), context, maxDepth, slotManager, false);
      } finally {
        slotManager.popContext();
      }
    }
    yield `</${tagName}>`;
    context.parentHost = prevParentHost;
    return;
  }

  const { templateOpenTag, styleTag, adoptKeys, adoptedUrls } = buildShadowStyleAndTemplateOpen(ctor, context);
  const shadowResult = (instance as any).render?.();
  const stateJson = context.resumable ? context.compilerBridge.serializeComponentState(instance, context) : '';

  const isFlattened = context.mode !== 'dsd';
  if (isFlattened) {
    slotManager.pushContext(tagName);
  }
  try {
    if (!isFlattened) {
      if (context.asyncState && context.streamingMode !== 'in-order' && shadowMayContainAsyncBoundary(shadowResult, context)) {
        const hostId = context.asyncState.nextHostId++;
        const hostAttrStr = serializeHostAttributeString(instance, {
          adoptKeys,
          adoptedUrls,
          hostId,
          stateJson,
          domPaths: context.domPaths,
          deferHydration: effectiveDeferHydration,
        });

        // Stream host open tag immediately without buffering shadow subtrees
        yield `<${tagName}${hostAttrStr}>`;
        yield templateOpenTag;
        if (styleTag) yield styleTag;
        context.asyncState.shadowPath.push(hostId);
        try {
          yield* renderShadowBodyWithAsyncTracking(instance, shadowResult, context, maxDepth, slotManager, true);
        } finally {
          context.asyncState.shadowPath.pop();
        }
        yield '</template>';
      } else {
        const hostAttrStr = serializeHostAttributeString(instance, {
          adoptKeys,
          adoptedUrls,
          stateJson,
          domPaths: context.domPaths,
          deferHydration: effectiveDeferHydration,
        });
        yield `<${tagName}${hostAttrStr}>`;
        yield templateOpenTag;
        if (styleTag) yield styleTag;
        yield* renderShadowBodyWithAsyncTracking(instance, shadowResult, context, maxDepth, slotManager, true);
        yield '</template>';
      }

      yield `</${tagName}>`;
    } else {
      const hostAttrStr = serializeHostAttributeString(instance, {
        domPaths: context.domPaths,
        deferHydration: effectiveDeferHydration,
      });
      yield `<${tagName}${hostAttrStr}>`;
      yield* renderShadowBodyWithAsyncTracking(instance, shadowResult, context, maxDepth, slotManager, false);
      yield `</${tagName}>`;
    }
  } finally {
    context.parentHost = prevParentHost;
    if (isFlattened) {
      slotManager.popContext();
    }
  }
}

export function renderToString(value: unknown, options?: RenderOptions): string {
  const { context, maxDepth, slotManager } = createSsrRenderContext(options);
  let result = '';
  for (const chunk of renderInternal(value, context, maxDepth, slotManager)) {
    result += chunk;
  }
  if (context.mode === 'dsd') {
    const urlEntries = context.styleDeduplicator.flushAdoptedUrlSheets();
    if (urlEntries.length > 0) {
      result += formatAdoptedUrlFallbackScript(urlEntries, context.nonce);
    }
    const adoptState = context.styleDeduplicator.consumePendingInlineAdoption();
    if (adoptState.needsCall) {
      result += formatCssAdoptScript(adoptState.needsBootstrap, context.nonce);
    }
  }
  return result;
}

function hasExpandableCustomElement(opcodes: SsrOpcode[], registry?: CustomElementRegistryLike, exclude?: RenderOptions['excludeElements']): boolean {
  if (!registry) return false;
  for (let i = 0; i < opcodes.length; i++) {
    const op = opcodes[i];
    if (op.type === 'open' && op.isCustomElement && !isElementExcluded(op.tag.toLowerCase(), exclude) && registry.get(op.tag)) {
      const closeTagIndex = findMatchingCloseTag(opcodes, i, opcodes.length);
      const childStart = i + 1;
      const childEnd = op.isVoid || op.isSelfClosing || closeTagIndex === i ? i + 1 : closeTagIndex;
      if (!hasExistingDeclarativeShadowRoot(opcodes, childStart, childEnd)) {
        return true;
      }
    }
  }
  return false;
}

function findLastBodyCloseOpcode(opcodes: SsrOpcode[]): number {
  for (let i = opcodes.length - 1; i >= 0; i--) {
    const op = opcodes[i];
    if (op.type === 'close' && op.tag === 'body') {
      return i;
    }
  }
  return -1;
}

export function renderHtmlDocument(html: string, options: RenderOptions = {}): string {
  if (!html) return html;
  const plan = compileHtmlDocumentPlan(html);
  const { context, maxDepth, slotManager } = createSsrRenderContext(options);
  if (!hasExpandableCustomElement(plan.opcodes, context.customElements, context.excludeElements)) {
    return html;
  }

  const bodyCloseIdx = findLastBodyCloseOpcode(plan.opcodes);
  let out = '';
  if (bodyCloseIdx >= 0) {
    for (const chunk of renderPlanV2Opcodes(plan.opcodes, [], context, maxDepth, slotManager, 0, bodyCloseIdx)) {
      out += chunk;
    }
    for (const chunk of flushStyleDeduplicationScripts(context)) {
      out += chunk;
    }
    for (const chunk of renderPlanV2Opcodes(plan.opcodes, [], context, maxDepth, slotManager, bodyCloseIdx, plan.opcodes.length)) {
      out += chunk;
    }
  } else {
    for (const chunk of renderPlanV2Opcodes(plan.opcodes, [], context, maxDepth, slotManager, 0, plan.opcodes.length)) {
      out += chunk;
    }
    for (const chunk of flushStyleDeduplicationScripts(context)) {
      out += chunk;
    }
  }
  return out;
}

export async function renderHtmlDocumentAsync(html: string, options: RenderOptions = {}): Promise<string> {
  if (!html) return html;
  const plan = compileHtmlDocumentPlan(html);
  const asyncState = createAsyncRenderState();
  const { context, maxDepth, slotManager } = createSsrRenderContext(options, asyncState);
  if (!hasExpandableCustomElement(plan.opcodes, context.customElements, context.excludeElements)) {
    return html;
  }

  const bodyCloseIdx = findLastBodyCloseOpcode(plan.opcodes);
  let out = '';
  if (bodyCloseIdx >= 0) {
    for (const chunk of renderPlanV2Opcodes(plan.opcodes, [], context, maxDepth, slotManager, 0, bodyCloseIdx)) {
      out += chunk;
    }
    if (asyncState.boundaries.length > 0 && !options.signal?.aborted) {
      for await (const chunk of drainPendingBoundariesOutOfOrder(asyncState, context, maxDepth, slotManager, options)) {
        out += chunk;
      }
    } else {
      for (const chunk of flushStyleDeduplicationScripts(context)) {
        out += chunk;
      }
    }
    for (const chunk of renderPlanV2Opcodes(plan.opcodes, [], context, maxDepth, slotManager, bodyCloseIdx, plan.opcodes.length)) {
      out += chunk;
    }
  } else {
    for (const chunk of renderPlanV2Opcodes(plan.opcodes, [], context, maxDepth, slotManager, 0, plan.opcodes.length)) {
      out += chunk;
    }
    if (asyncState.boundaries.length > 0 && !options.signal?.aborted) {
      for await (const chunk of drainPendingBoundariesOutOfOrder(asyncState, context, maxDepth, slotManager, options)) {
        out += chunk;
      }
    } else {
      for (const chunk of flushStyleDeduplicationScripts(context)) {
        out += chunk;
      }
    }
  }
  return out;
}

function wrapBoundaryPromiseWithDeadline(entry: SsrPendingBoundaryEntry, timeoutMs?: number, signal?: AbortSignal): Promise<{ id: number; ok: boolean; value: unknown }> {
  const effectiveTimeoutMs = timeoutMs === undefined ? DEFAULT_BOUNDARY_TIMEOUT_MS : timeoutMs;

  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onAbort = () => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve({
        id: entry.id,
        ok: false,
        value: signal?.reason ?? new Error('SSR stream aborted'),
      });
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    if (typeof effectiveTimeoutMs === 'number' && Number.isFinite(effectiveTimeoutMs) && effectiveTimeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve({
          id: entry.id,
          ok: false,
          value: new Error(`SSR async boundary ${entry.id} timed out after ${effectiveTimeoutMs}ms`),
        });
      }, effectiveTimeoutMs);
    }

    entry.promise.then(
      (val) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve({ id: entry.id, ok: true, value: val });
      },
      (err) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve({ id: entry.id, ok: false, value: err });
      },
    );
  });
}

export async function* drainPendingBoundariesOutOfOrder(
  asyncState: SsrAsyncRenderState,
  context: SsrRenderContext,
  maxDepth: number,
  slotManager: SlotManager,
  options: RenderOptions = {},
): AsyncIterableIterator<string> {
  if (asyncState.boundaries.length === 0) {
    yield* flushStyleDeduplicationScripts(context);
    return;
  }

  if (!asyncState.bootstrapEmitted) {
    asyncState.bootstrapEmitted = true;
    yield formatSdsdBootstrapScript(options.nonce);
  }

  const inFlight = new Map<
    number,
    {
      entry: SsrPendingBoundaryEntry;
      raced: Promise<{ id: number; ok: boolean; value: unknown }>;
    }
  >();

  const enqueuePending = () => {
    while (asyncState.boundaries.length > 0) {
      const entry = asyncState.boundaries.shift();
      if (!entry) break;
      inFlight.set(entry.id, {
        entry,
        raced: wrapBoundaryPromiseWithDeadline(entry, options.timeoutMs, options.signal),
      });
    }
  };

  enqueuePending();

  while (inFlight.size > 0) {
    if (options.signal?.aborted) {
      break;
    }

    const settled = await Promise.race(Array.from(inFlight.values(), (item) => item.raced));
    const record = inFlight.get(settled.id);
    if (!record) continue;
    inFlight.delete(settled.id);

    if (options.signal?.aborted) {
      break;
    }

    const { entry } = record;
    let valueToRender: unknown;
    let hostAttributes: Record<string, string | null> | undefined;
    let shouldEmitSwap = true;

    if (settled.ok) {
      if (isBoundaryPayload(settled.value)) {
        valueToRender = settled.value.content;
        hostAttributes = settled.value.hostAttributes;
      } else {
        valueToRender = settled.value;
      }
    } else {
      options.onError?.(settled.value, { phase: 'asyncBoundary' });
      if (entry.errorFallback) {
        valueToRender = entry.errorFallback(settled.value);
      } else if (options.errorFallback !== undefined) {
        valueToRender = typeof options.errorFallback === 'function' ? (options.errorFallback as (err: unknown) => unknown)(settled.value) : options.errorFallback;
      } else {
        shouldEmitSwap = false;
      }
    }

    if (shouldEmitSwap) {
      const prevShadowPath = [...asyncState.shadowPath];
      asyncState.shadowPath.length = 0;
      asyncState.shadowPath.push(...entry.shadowPath);
      let chunkHtml = '';
      try {
        for (const piece of renderInternal(valueToRender, context, maxDepth, slotManager)) {
          chunkHtml += piece;
        }
      } finally {
        asyncState.shadowPath.length = 0;
        asyncState.shadowPath.push(...prevShadowPath);
      }

      const chunkId = `c${asyncState.nextChunkId++}`;
      const isSvg = Boolean(valueToRender !== null && typeof valueToRender === 'object' && (valueToRender as any)._$litType$ === 2);
      yield formatSdsdTailChunk(chunkId, entry.shadowPath, entry.id, chunkHtml, options.nonce, isSvg, hostAttributes);
      for (const styleScript of flushStyleDeduplicationScripts(context)) {
        yield styleScript;
      }
    }

    enqueuePending();
  }

  yield* flushStyleDeduplicationScripts(context);
}

async function* renderInOrderInternal(value: unknown, options: RenderOptions): AsyncIterableIterator<string> {
  const asyncState = createAsyncRenderState();
  const { context, maxDepth, slotManager } = createSsrRenderContext({ ...options, streamingMode: 'in-order' }, asyncState);
  let rawShell = '';
  for (const chunk of renderInternal(value, context, maxDepth, slotManager)) {
    rawShell += chunk;
  }

  if (asyncState.boundaries.length === 0) {
    if (rawShell.length > 0) yield rawShell;
    yield* flushStyleDeduplicationScripts(context);
    return;
  }

  const boundaryById = new Map<number, SsrPendingBoundaryEntry>();
  for (const entry of asyncState.boundaries) {
    boundaryById.set(entry.id, entry);
  }

  let cursor = 0;
  const startMarkerRegex = /<!--\$b:(\d+)-->/g;
  let match = startMarkerRegex.exec(rawShell);

  while (match !== null) {
    if (options.signal?.aborted) break;
    const boundaryId = Number(match[1]);
    const markerStart = match.index;
    const contentStart = markerStart + match[0].length;
    const endMarker = `<!--/$b:${boundaryId}-->`;
    const endMarkerIdx = rawShell.indexOf(endMarker, contentStart);

    if (endMarkerIdx === -1) {
      break;
    }

    if (markerStart > cursor) {
      yield rawShell.slice(cursor, markerStart);
    }

    const fallbackHtml = rawShell.slice(contentStart, endMarkerIdx);
    const entry = boundaryById.get(boundaryId);

    if (entry) {
      const settled = await wrapBoundaryPromiseWithDeadline(entry, options.timeoutMs, options.signal);
      if (options.signal?.aborted) break;

      if (settled.ok) {
        const inner = isBoundaryPayload(settled.value) ? settled.value.content : settled.value;
        yield* renderInOrderInternal(inner, options);
      } else {
        options.onError?.(settled.value, { phase: 'asyncBoundary' });
        if (entry.errorFallback) {
          yield* renderInOrderInternal(entry.errorFallback(settled.value), options);
        } else if (options.errorFallback !== undefined) {
          const errVal = typeof options.errorFallback === 'function' ? (options.errorFallback as (err: unknown) => unknown)(settled.value) : options.errorFallback;
          yield* renderInOrderInternal(errVal, options);
        } else if (fallbackHtml.length > 0) {
          yield fallbackHtml;
        }
      }
    } else if (fallbackHtml.length > 0) {
      yield fallbackHtml;
    }

    cursor = endMarkerIdx + endMarker.length;
    startMarkerRegex.lastIndex = cursor;
    match = startMarkerRegex.exec(rawShell);
  }

  if (!options.signal?.aborted && cursor < rawShell.length) {
    yield rawShell.slice(cursor);
  }
  yield* flushStyleDeduplicationScripts(context);
}

export function createSyncAndAsyncBoundaryIterators(
  value: unknown,
  options: RenderOptions = {},
): {
  syncIterator: IterableIterator<string>;
  hasPendingBoundaries: () => boolean;
  createAsyncDrainIterator: () => AsyncIterableIterator<string>;
} {
  const streamingMode = options.streamingMode ?? 'out-of-order';
  if (streamingMode === 'sync' || (options.mode ?? 'dsd') === 'flattened') {
    return {
      syncIterator: render(value, options),
      hasPendingBoundaries: () => false,
      createAsyncDrainIterator: async function* () {},
    };
  }

  const asyncState = createAsyncRenderState();
  const { context, maxDepth, slotManager } = createSsrRenderContext(options, asyncState);
  function* syncWithStyles(): IterableIterator<string> {
    yield* renderInternal(value, context, maxDepth, slotManager);
    if (asyncState.boundaries.length === 0) {
      yield* flushStyleDeduplicationScripts(context);
    }
  }

  return {
    syncIterator: syncWithStyles(),
    hasPendingBoundaries: () => asyncState.boundaries.length > 0,
    createAsyncDrainIterator: () => drainPendingBoundariesOutOfOrder(asyncState, context, maxDepth, slotManager, options),
  };
}

export async function* renderAsync(value: unknown, options: RenderOptions = {}): AsyncIterableIterator<string> {
  const streamingMode = options.streamingMode ?? 'out-of-order';

  if (streamingMode === 'sync' || (options.mode ?? 'dsd') === 'flattened') {
    for (const chunk of render(value, options)) {
      if (options.signal?.aborted) break;
      yield chunk;
    }
    return;
  }

  if (streamingMode === 'in-order') {
    yield* renderInOrderInternal(value, options);
    return;
  }

  const asyncState = createAsyncRenderState();
  const { context, maxDepth, slotManager } = createSsrRenderContext(options, asyncState);

  for (const chunk of renderInternal(value, context, maxDepth, slotManager)) {
    if (options.signal?.aborted) return;
    yield chunk;
  }

  if (asyncState.boundaries.length > 0 && !options.signal?.aborted) {
    yield* drainPendingBoundariesOutOfOrder(asyncState, context, maxDepth, slotManager, options);
  } else if (!options.signal?.aborted) {
    yield* flushStyleDeduplicationScripts(context);
  }
}

export async function renderToStringAsync(value: unknown, options?: RenderOptions): Promise<string> {
  let result = '';
  for await (const chunk of renderAsync(value, options)) {
    result += chunk;
  }
  return result;
}

export async function collectResult(result: Iterable<string> | AsyncIterable<string> | ReadableStream<Uint8Array>): Promise<string> {
  if (result && typeof (result as any).getReader === 'function') {
    const reader = (result as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        accumulated += decoder.decode(value, { stream: true });
      }
    }
    accumulated += decoder.decode();
    return accumulated;
  }

  if (result && typeof (result as any)[Symbol.asyncIterator] === 'function') {
    let accumulated = '';
    for await (const chunk of result as AsyncIterable<string>) {
      accumulated += chunk;
    }
    return accumulated;
  }

  if (result && typeof (result as any)[Symbol.iterator] === 'function') {
    let accumulated = '';
    for (const chunk of result as Iterable<string>) {
      accumulated += chunk;
    }
    return accumulated;
  }

  return '';
}
