/**
 * Compiler integration bridge for @lit-core/ssr.
 * Bridges @lit-core/html-aot, @lit-core/css-fuse, @lit-core/directives,
 * and @lit-core/resumable. This module is part of the runtime entry and must stay
 * free of Node-only imports (node:*, native addons) so it loads on any JS runtime.
 */

import { extractComponentState as resumableExtractComponentState, serializeStateToJson as resumableSerializeStateToJson } from '@lit-core/resumable/server';
import type { CustomElementRegistryLike, HTMLElementStub } from './environment.js';

export const LIT_NOTHING = Symbol.for('lit-nothing');
export const LIT_NO_CHANGE = Symbol.for('lit-noChange');
export const SSR_ASYNC_BOUNDARY = Symbol.for('lit-core-ssr-async-boundary');

const RAW_HTML_BRAND = Symbol('lit-core.ssr.trusted-raw-html');
const SSR_BOUNDARY_PAYLOAD = Symbol('lit-core.ssr.boundary-payload');

export interface TrustedRawHtml {
  readonly [RAW_HTML_BRAND]: true;
  readonly html: string;
}

export function createTrustedRawHtml(html: string): TrustedRawHtml {
  return Object.freeze({
    [RAW_HTML_BRAND]: true as const,
    html,
  });
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

export interface SsrBoundaryPayload {
  readonly [SSR_BOUNDARY_PAYLOAD]: true;
  readonly content: unknown;
  readonly hostAttributes?: Record<string, string | null>;
}

export function createBoundaryPayload(content: unknown, hostAttributes?: Record<string, string | null>): SsrBoundaryPayload {
  return {
    [SSR_BOUNDARY_PAYLOAD]: true,
    content,
    hostAttributes,
  };
}

export function isBoundaryPayload(value: unknown): value is SsrBoundaryPayload {
  return value !== null && typeof value === 'object' && (value as any)[SSR_BOUNDARY_PAYLOAD] === true;
}

export interface SsrAsyncBoundaryDescriptor {
  readonly [SSR_ASYNC_BOUNDARY]: true;
  readonly promise: Promise<unknown>;
  readonly fallback: unknown;
  readonly errorFallback?: (error: unknown) => unknown;
}

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function') && typeof (value as any).then === 'function';
}

export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return value !== null && typeof value === 'object' && typeof (value as any)[Symbol.asyncIterator] === 'function';
}

export function isAsyncBoundaryDescriptor(value: unknown): value is SsrAsyncBoundaryDescriptor {
  return value !== null && typeof value === 'object' && (value as any)[SSR_ASYNC_BOUNDARY] === true;
}

export function createAsyncBoundary(promise: PromiseLike<unknown>, fallback: unknown = LIT_NOTHING, errorFallback?: (error: unknown) => unknown): SsrAsyncBoundaryDescriptor {
  return {
    [SSR_ASYNC_BOUNDARY]: true,
    promise: Promise.resolve(promise),
    fallback,
    errorFallback,
  };
}

export function isNothing(val: unknown): boolean {
  if (val === LIT_NOTHING || val === LIT_NO_CHANGE) return true;
  if (typeof val === 'symbol') {
    const desc = val.description;
    return desc === 'lit-nothing' || desc === 'lit-noChange';
  }
  return false;
}

export interface SsrPartDescriptor {
  kind: 'child' | 'attribute' | 'boolean' | 'property' | 'event';
  index: number;
  name?: string;
  strings?: string[];
}

export interface SsrCustomElementDescriptor {
  tagName: string;
  isSelfClosing: boolean;
  siteId: number;
  staticAttrs: Record<string, string>;
  dynamicAttrPartIndices: number[];
  slottedChildIndices: number[];
}

export interface SsrSlotDescriptor {
  slotName: string;
  fallbackChunkIndices: number[];
}

export type SsrDynamicAttribute =
  | { type: 'attribute'; name: string; index: number; indices?: number[]; strings?: string[] }
  | { type: 'boolean'; name: string; index: number }
  | { type: 'property'; name: string; index: number; indices?: number[]; strings?: string[] }
  | { type: 'event'; name: string; index: number }
  | { type: 'directive'; index: number };

export type SsrOpcode =
  | {
      type: 'open';
      tag: string;
      isCustomElement?: boolean;
      isVoid?: boolean;
      isSelfClosing?: boolean;
      namespace?: string;
      staticAttrs?: Record<string, string>;
      dynamicAttrs?: SsrDynamicAttribute[];
      closeIndex?: number;
    }
  | { type: 'close'; tag: string }
  | { type: 'text'; value: string }
  | { type: 'comment'; value: string }
  | { type: 'part'; index: number }
  | { type: 'marker-start'; name: string; h?: string }
  | { type: 'marker-end' };

export interface SsrMarkerSite {
  name: string;
  index: number;
  parentPath: number[];
  startPath: number[];
}

export interface SsrTemplatePlanV1 {
  v: 1;
  chunks: string[];
  parts: SsrPartDescriptor[];
  customElements: SsrCustomElementDescriptor[];
  slots: SsrSlotDescriptor[];
}

export interface SsrTemplatePlanV2 {
  v: 2;
  h: string;
  opcodes: SsrOpcode[];
  markerSites: SsrMarkerSite[];
  parts: unknown[];
}

export type SsrTemplatePlan = SsrTemplatePlanV1 | SsrTemplatePlanV2;

export interface CompiledTemplatePart {
  type: number;
  index: number;
  name?: string;
  strings?: string[];
  ctor?: unknown;
  ctorType?: number;
}

export interface CompiledTemplateDescriptor {
  h: TemplateStringsArray | string[] | string;
  parts: CompiledTemplatePart[];
  ssrPlan?: SsrTemplatePlan;
}

export interface CompiledTemplateResult {
  _$litType$: CompiledTemplateDescriptor;
  values: unknown[];
}

export interface SsrPendingBoundaryEntry {
  readonly id: number;
  readonly shadowPath: number[];
  readonly promise: Promise<unknown>;
  readonly errorFallback?: (error: unknown) => unknown;
}

export interface SsrAsyncRenderState {
  nextHostId: number;
  nextBoundaryId: number;
  nextChunkId: number;
  readonly shadowPath: number[];
  readonly boundaries: SsrPendingBoundaryEntry[];
  bootstrapEmitted: boolean;
}

export interface SsrRenderContext {
  depth: number;
  resumable: boolean;
  domPaths: boolean;
  cssFuse: boolean;
  mode: 'dsd' | 'flattened';
  customElements?: CustomElementRegistryLike;
  state?: Record<string, unknown>;
  styleDeduplicator: StyleDeduplicator;
  compilerBridge: CompilerBridge;
  renderValue: (val: unknown, ctx: SsrRenderContext) => Iterable<string>;
  parentHost?: HTMLElementStub | null;
  contextLookup?: (key: unknown) => { found: boolean; value: unknown };
  onError?: (error: unknown, info: { tagName?: string; phase: string }) => void;
  strictLifecycle?: boolean;
  adoptedStyleSheets?: { urlResolver?: (sheetKey: string, css: string) => string };
  asyncState?: SsrAsyncRenderState;
  edge?: boolean;
  streamingMode?: 'in-order' | 'out-of-order' | 'sync';
  nonce?: string;
  deferHydration?: boolean;
  litShadowDepth?: number;
  hydratableScope?: boolean;
  customElementRendered?: (tagName: string) => void;
  excludeElements?: ReadonlySet<string> | readonly string[] | ((tagName: string) => boolean);
  shouldCallConnectedCallback?: (tagName: string, instance: unknown) => boolean;
  serverElementAdapter?: {
    canHandle(Ctor: new () => any, tagName: string): boolean;
    prepareBoundary(input: { instance: any; Ctor: new () => any; tagName: string; hostId: number; incomingAttrs: Record<string, string>; ssrContext: SsrRenderContext }): {
      immediateHostAttributes?: Record<string, string>;
      pendingContent?: unknown;
      boundaryPromise: Promise<unknown>;
    };
  };
}

export function isCompiledTemplateResult(value: unknown): value is CompiledTemplateResult {
  if (value === null || typeof value !== 'object') return false;
  const litType = (value as any)._$litType$;
  return litType !== null && typeof litType === 'object' && 'h' in litType && (!('parts' in litType) || litType.parts == null || Array.isArray(litType.parts)) && Array.isArray((value as any).values);
}

export function isStandardTemplateResult(value: unknown): value is { strings: TemplateStringsArray; values: unknown[]; _$litType$?: unknown } {
  if (value === null || typeof value !== 'object') return false;
  const litType = (value as any)._$litType$;
  return (typeof litType === 'number' || typeof litType === 'string' || typeof litType === 'undefined') && Array.isArray((value as any).strings) && Array.isArray((value as any).values);
}

function getPrototypeDepthAboveObject(ctor: Function): number {
  let depth = 0;
  let proto = ctor.prototype;
  while (proto && proto !== Object.prototype) {
    depth++;
    proto = Object.getPrototypeOf(proto);
  }
  return depth;
}

async function consumeAsyncIterableDirective(iterable: AsyncIterable<unknown>, mapper: unknown, accumulateAll: boolean): Promise<unknown> {
  const mapFn = typeof mapper === 'function' ? (mapper as (v: unknown, index: number) => unknown) : null;
  if (accumulateAll) {
    const items: unknown[] = [];
    let index = 0;
    for await (const raw of iterable) {
      items.push(mapFn ? mapFn(raw, index) : raw);
      index++;
    }
    return items;
  }

  let hasValue = false;
  let lastValue: unknown = LIT_NOTHING;
  let index = 0;
  for await (const raw of iterable) {
    hasValue = true;
    lastValue = mapFn ? mapFn(raw, index) : raw;
    index++;
  }
  return hasValue ? lastValue : LIT_NOTHING;
}

export function resolveDirectiveValue(value: unknown, partInfo: { type: number; name?: string; tagName?: string; strings?: readonly string[] } = { type: 2 }): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (isAsyncBoundaryDescriptor(value) || isTrustedRawHtml(value)) {
    return value;
  }

  const directiveCtor = (value as any)._$litDirective$;
  if (typeof directiveCtor === 'function') {
    const args: unknown[] = Array.isArray((value as any).values) ? (value as any).values : [];
    let directiveInstance: any = null;
    try {
      directiveInstance = new directiveCtor(partInfo);
    } catch {
      directiveInstance = null;
    }

    let rendered: unknown = value;
    let didRender = false;
    if (directiveInstance && typeof directiveInstance.render === 'function') {
      rendered = directiveInstance.render(...args);
      didRender = true;
    } else if (typeof directiveCtor.prototype?.render === 'function') {
      rendered = directiveCtor.prototype.render.apply({ _$part: partInfo }, args);
      didRender = true;
    }

    if (didRender) {
      // Detect Lit's unsafeHTML / unsafeSVG / unsafeMathML directive results without relying on
      // class names (minification-safe): ECMAScript tagged template literals always freeze
      // TemplateStringsArray, whereas UnsafeHTMLDirective wraps its raw string argument into a
      // synthetic unfrozen 1-element strings array with zero dynamic values.
      if (
        partInfo.type === 2 &&
        args.length >= 1 &&
        typeof args[0] === 'string' &&
        isStandardTemplateResult(rendered) &&
        rendered.values.length === 0 &&
        rendered.strings.length === 1 &&
        rendered.strings[0] === args[0] &&
        !Object.isFrozen(rendered.strings)
      ) {
        return createTrustedRawHtml(args[0]);
      }

      // Detect asyncAppend / asyncReplace directives: render() returns noChange while args[0]
      // is an AsyncIterable. AsyncAppendDirective subclasses AsyncReplaceDirective -> AsyncDirective -> Directive
      // (depth >= 4 above Object.prototype), whereas AsyncReplaceDirective has depth 3.
      if (partInfo.type === 2 && (rendered === LIT_NO_CHANGE || isNothing(rendered)) && args.length >= 1 && isAsyncIterable(args[0])) {
        const protoDepth = getPrototypeDepthAboveObject(directiveCtor);
        const accumulateAll = protoDepth >= 4;
        return createAsyncBoundary(consumeAsyncIterableDirective(args[0], args[1], accumulateAll), LIT_NOTHING);
      }

      // If a child-part directive (such as lit/directives/until.js) received a higher-priority
      // Promise argument before its synchronous fallback, pair the Promise and fallback into
      // an SsrAsyncBoundaryDescriptor without relying on directive class names (minification-safe).
      if (partInfo.type === 2 && !isThenable(rendered) && !isAsyncBoundaryDescriptor(rendered) && args.length > 0) {
        let firstThenable: PromiseLike<unknown> | null = null;
        for (let i = 0; i < args.length; i++) {
          const arg = args[i];
          if (arg === rendered) {
            break;
          }
          if (isThenable(arg)) {
            firstThenable = arg;
            break;
          }
        }
        if (firstThenable) {
          return createAsyncBoundary(firstThenable, rendered);
        }
      }
      if (rendered !== null && typeof rendered === 'object' && rendered !== value && typeof (rendered as any)._$litDirective$ === 'function') {
        return resolveDirectiveValue(rendered, partInfo);
      }
      return rendered;
    }
  }

  return value;
}

const HTML_ESCAPE_RE = /[&<>"]/;
const HTML_ESCAPE_GLOBAL_RE = /[&<>"]/g;
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

function replaceHtmlChar(ch: string): string {
  return HTML_ESCAPE_MAP[ch];
}

export function escapeHtml(str: string): string {
  return HTML_ESCAPE_RE.test(str) ? str.replace(HTML_ESCAPE_GLOBAL_RE, replaceHtmlChar) : str;
}

export function escapeAttribute(str: string): string {
  return HTML_ESCAPE_RE.test(str) ? str.replace(HTML_ESCAPE_GLOBAL_RE, replaceHtmlChar) : str;
}

export interface SharedStyleEntry {
  key: string;
  css: string;
  styleTag: string;
}

export interface ExtractedStyles {
  sharedSheets: string[];
  localStyles: string[];
  sharedEntries: SharedStyleEntry[];
  allSharedKeys: string[];
  inlinedAllStyleTag: string;
  inlinedLocalStyleTag: string;
  inlinedLocalDataStyleTag: string;
}

export interface ResolvedComponentStyles {
  firstTimeShared: SharedStyleEntry[];
  adoptedSharedKeys: string[];
  allSharedEntries: SharedStyleEntry[];
  localStyles: string[];
}

const EMPTY_STRING_ARRAY: string[] = [];
const EMPTY_SHARED_ENTRIES: SharedStyleEntry[] = [];
const EMPTY_EXTRACTED_STYLES: ExtractedStyles = {
  sharedSheets: EMPTY_STRING_ARRAY,
  localStyles: EMPTY_STRING_ARRAY,
  sharedEntries: EMPTY_SHARED_ENTRIES,
  allSharedKeys: EMPTY_STRING_ARRAY,
  inlinedAllStyleTag: '',
  inlinedLocalStyleTag: '',
  inlinedLocalDataStyleTag: '',
};

export class StyleDeduplicator {
  private seenSharedSheets: Set<string> | null = null;
  private inlineEmittedSheets: Set<string> | null = null;
  private urlFallbackSheets: Map<string, string> | null = null;
  private collectedStyles: string[] | null = null;
  private pendingStyles: Array<{ key: string; css: string }> | null = null;
  private pendingInlineAdoption = false;
  private adoptBootstrapEmitted = false;
  private static ctorStyleCache = new WeakMap<any, ExtractedStyles>();

  public static resetCache(): void {
    StyleDeduplicator.ctorStyleCache = new WeakMap<any, ExtractedStyles>();
  }

  public processComponentStyles(ctor: any): ExtractedStyles {
    if (ctor) {
      const cached = StyleDeduplicator.ctorStyleCache.get(ctor);
      if (cached) {
        const entries = cached.sharedEntries;
        if (entries.length > 0) {
          const seen = (this.seenSharedSheets ??= new Set<string>());
          for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (!seen.has(entry.key)) {
              seen.add(entry.key);
              (this.collectedStyles ??= []).push(entry.css);
              (this.pendingStyles ??= []).push(entry);
            }
          }
        }
        return cached;
      }
    }

    const rawStyles = ctor?.styles;
    if (!rawStyles) {
      if (ctor) StyleDeduplicator.ctorStyleCache.set(ctor, EMPTY_EXTRACTED_STYLES);
      return EMPTY_EXTRACTED_STYLES;
    }

    const flatStyles = Array.isArray(rawStyles) ? rawStyles.flat(Infinity) : [rawStyles];
    const shared: string[] = [];
    const local: string[] = [];
    const sharedEntries: SharedStyleEntry[] = [];
    const allSharedKeys: string[] = [];

    for (const item of flatStyles) {
      if (!item) continue;
      const cssText = typeof item === 'string' ? item : (item.cssText ?? String(item));
      const trimmed = cssText.trim();
      if (!trimmed) continue;

      const isFused = Boolean((item as any)._fusedId || (item as any)._fused || trimmed.includes('/* @lit-core/css-fuse */'));
      const sheetKey = (item as any)._fusedId || this.hashCss(trimmed);

      if (isFused || this.isSharedCandidate(trimmed)) {
        const entry: SharedStyleEntry = {
          key: sheetKey,
          css: trimmed,
          styleTag: `<style data-lit-sheet="${escapeAttribute(sheetKey)}">${trimmed}</style>`,
        };
        const seen = (this.seenSharedSheets ??= new Set<string>());
        if (!seen.has(sheetKey)) {
          seen.add(sheetKey);
          (this.collectedStyles ??= []).push(trimmed);
          (this.pendingStyles ??= []).push(entry);
        }
        shared.push(trimmed);
        sharedEntries.push(entry);
        allSharedKeys.push(sheetKey);
      } else {
        local.push(trimmed);
      }
    }

    const inlinedLocalCss = local.length > 0 ? local.join('\n') : '';
    const allParts = shared.length > 0 ? (local.length > 0 ? [...shared, ...local] : shared) : local;
    const inlinedAllCss = allParts.length > 0 ? allParts.join('\n') : '';

    const result: ExtractedStyles = {
      sharedSheets: shared,
      localStyles: local,
      sharedEntries,
      allSharedKeys,
      inlinedAllStyleTag: inlinedAllCss.length > 0 ? `<style>${inlinedAllCss}</style>` : '',
      inlinedLocalStyleTag: inlinedLocalCss.length > 0 ? `<style>${inlinedLocalCss}</style>` : '',
      inlinedLocalDataStyleTag: inlinedLocalCss.length > 0 ? `<style data-lit-local>${inlinedLocalCss}</style>` : '',
    };
    if (ctor) StyleDeduplicator.ctorStyleCache.set(ctor, result);
    return result;
  }

  public resolveDefaultStyleTag(ctor: any, cssFuse: boolean): { styleTag: string; adoptKeys: string[] } {
    if (!cssFuse) {
      let cached = ctor ? StyleDeduplicator.ctorStyleCache.get(ctor) : undefined;
      if (!cached) {
        cached = this.processComponentStyles(ctor);
      }
      return { styleTag: cached.inlinedAllStyleTag, adoptKeys: EMPTY_STRING_ARRAY };
    }

    const extracted = this.processComponentStyles(ctor);
    const sharedEntries = extracted.sharedEntries;
    if (sharedEntries.length === 0) {
      return { styleTag: extracted.inlinedLocalStyleTag, adoptKeys: EMPTY_STRING_ARRAY };
    }

    const emitted = (this.inlineEmittedSheets ??= new Set<string>());
    let styleTag = '';
    let adoptedSharedKeys: string[] | null = null;

    for (let i = 0; i < sharedEntries.length; i++) {
      const entry = sharedEntries[i];
      if (!emitted.has(entry.key)) {
        emitted.add(entry.key);
        styleTag += entry.styleTag;
      } else {
        (adoptedSharedKeys ??= []).push(entry.key);
        this.pendingInlineAdoption = true;
      }
    }

    if (extracted.localStyles.length > 0) {
      styleTag += adoptedSharedKeys !== null ? extracted.inlinedLocalDataStyleTag : extracted.inlinedLocalStyleTag;
    }

    return {
      styleTag,
      adoptKeys: adoptedSharedKeys ?? EMPTY_STRING_ARRAY,
    };
  }

  public resolveComponentStyles(ctor: any, cssFuse: boolean): ResolvedComponentStyles {
    const extracted = this.processComponentStyles(ctor);
    const sharedEntries = extracted.sharedEntries;

    if (!cssFuse) {
      return {
        firstTimeShared: EMPTY_SHARED_ENTRIES,
        adoptedSharedKeys: EMPTY_STRING_ARRAY,
        allSharedEntries: sharedEntries,
        localStyles: extracted.sharedSheets.length > 0 ? [...extracted.sharedSheets, ...extracted.localStyles] : extracted.localStyles,
      };
    }

    if (sharedEntries.length === 0) {
      return {
        firstTimeShared: EMPTY_SHARED_ENTRIES,
        adoptedSharedKeys: EMPTY_STRING_ARRAY,
        allSharedEntries: sharedEntries,
        localStyles: extracted.localStyles,
      };
    }

    const emitted = (this.inlineEmittedSheets ??= new Set<string>());
    const firstTimeShared: SharedStyleEntry[] = [];
    const adoptedSharedKeys: string[] = [];

    for (let i = 0; i < sharedEntries.length; i++) {
      const entry = sharedEntries[i];
      if (!emitted.has(entry.key)) {
        emitted.add(entry.key);
        firstTimeShared.push(entry);
      } else {
        adoptedSharedKeys.push(entry.key);
        this.pendingInlineAdoption = true;
      }
    }

    return {
      firstTimeShared,
      adoptedSharedKeys,
      allSharedEntries: sharedEntries,
      localStyles: extracted.localStyles,
    };
  }

  public recordAdoptedUrlSheet(url: string, css: string): void {
    const map = (this.urlFallbackSheets ??= new Map<string, string>());
    if (!map.has(url)) {
      map.set(url, css);
    }
  }

  public flushAdoptedUrlSheets(): Array<{ url: string; css: string }> {
    if (!this.urlFallbackSheets || this.urlFallbackSheets.size === 0) return EMPTY_SHARED_ENTRIES as any;
    const entries = Array.from(this.urlFallbackSheets.entries(), ([url, css]) => ({ url, css }));
    this.urlFallbackSheets.clear();
    return entries;
  }

  public consumePendingInlineAdoption(): { needsBootstrap: boolean; needsCall: boolean } {
    if (!this.pendingInlineAdoption) {
      return { needsBootstrap: false, needsCall: false };
    }
    this.pendingInlineAdoption = false;
    const needsBootstrap = !this.adoptBootstrapEmitted;
    this.adoptBootstrapEmitted = true;
    return { needsBootstrap, needsCall: true };
  }

  public getCollectedStyles(): string[] {
    return this.collectedStyles ? [...this.collectedStyles] : [];
  }

  public flushPendingSharedStyles(): Array<{ key: string; css: string }> {
    if (!this.pendingStyles || this.pendingStyles.length === 0) return [];
    return this.pendingStyles.splice(0, this.pendingStyles.length);
  }

  private hashCss(css: string): string {
    let hash = 5381;
    for (let i = 0; i < css.length; i++) {
      hash = (hash * 33) ^ css.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
  }

  private isSharedCandidate(css: string): boolean {
    return css.length > 256;
  }
}

export class CompilerBridge {
  readonly styleDeduplicator = new StyleDeduplicator();

  public isCompiled(value: unknown): value is CompiledTemplateResult {
    return isCompiledTemplateResult(value);
  }

  public extractComponentStyles(ctor: any): { shared: string[]; local: string[]; sharedEntries: Array<{ key: string; css: string }> } {
    const res = this.styleDeduplicator.processComponentStyles(ctor);
    return { shared: res.sharedSheets, local: res.localStyles, sharedEntries: res.sharedEntries ?? [] };
  }

  /**
   * Extracts component state as a serialized JSON string for the `data-lit-state` host attribute.
   */
  public serializeComponentState(component: any, context: SsrRenderContext): string {
    if (!context.resumable) return '';
    try {
      const stateObj = resumableExtractComponentState(component);
      if (stateObj && Object.keys(stateObj).length > 0) {
        return resumableSerializeStateToJson(stateObj);
      }
    } catch {}
    if (context.state && Object.keys(context.state).length > 0) {
      try {
        return resumableSerializeStateToJson(context.state);
      } catch {
        return '';
      }
    }
    return '';
  }
}
