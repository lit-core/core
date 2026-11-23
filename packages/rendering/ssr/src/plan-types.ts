import type { BoundaryGroup } from './boundary-descriptors.js';
import type { CompilerBridge } from './compiler-bridge.js';
import type { CustomElementLookup, HTMLElementStub } from './environment.js';
import type { StyleDeduplicator } from './style-deduplicator.js';

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
  readonly group?: BoundaryGroup;
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
  customElements?: CustomElementLookup;
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
