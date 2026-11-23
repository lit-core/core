/**
 * @lit-core/ssr
 * Universal ahead-of-time server-side rendering engine for Lit and Web Components
 * emitting clean Declarative Shadow DOM with zero comment markers.
 */

export { collectResult, createSyncAndAsyncBoundaryIterators, drainPendingBoundariesOutOfOrder, renderAsync, renderHtmlDocumentAsync, renderToStringAsync } from './async-render.js';
export { createAsyncRenderState } from './async-state.js';
export {
  compileHtmlDocumentPlan,
  compileLitDescriptorPlan,
  compileTemplatePlan,
  extractHtmlModuleScripts,
  initSsrWasm,
  initSsrWasmSync,
  isSsrWasmReady,
  registerSsrWasmModule,
  setForceWasmCompiler,
  type TransformSsrOptions,
  type TransformSsrResult,
  transformSsrComponent,
} from './compiler.js';
export {
  type AsyncBoundaryOptions,
  type BoundaryGroup,
  type CompiledTemplateDescriptor,
  type CompiledTemplatePart,
  type CompiledTemplateResult,
  CompilerBridge,
  createAsyncBoundary,
  createBoundaryPayload,
  createTrustedRawHtml,
  type ExtractedStyles,
  escapeAttribute,
  escapeHtml,
  isAsyncBoundaryDescriptor,
  isAsyncIterable,
  isBoundaryPayload,
  isCompiledTemplateResult,
  isStandardTemplateResult,
  isThenable,
  isTrustedRawHtml,
  LIT_NO_CHANGE,
  LIT_NOTHING,
  type ResolvedComponentStyles,
  type RevealOrder,
  resolveDirectiveValue,
  SSR_ASYNC_BOUNDARY,
  type SsrAsyncBoundaryDescriptor,
  type SsrAsyncRenderState,
  type SsrBoundaryPayload,
  type SsrCustomElementDescriptor,
  type SsrOpcode,
  type SsrPendingBoundaryEntry,
  type SsrRenderContext,
  type SsrTemplatePlan,
  type SsrTemplatePlanV2,
  StyleDeduplicator,
  type TrustedRawHtml,
  unsafeCSS,
  unsafeHTML,
  unsafeMathML,
  unsafeSVG,
} from './compiler-bridge.js';
export { readLiveHostAttributesMap } from './component/host-attributes.js';
export { type ComponentLifecycleInput, executeComponentLifecycleAndReflection, prepareAndRunComponentLifecycle, prepareComponentBindings } from './component/lifecycle.js';
export {
  ARIA_MIXIN_ATTRIBUTES,
  type Context,
  type ContextCallback,
  ContextRequestEvent,
  CSSStyleSheetStub,
  type CustomElementLookup,
  type CustomElementRegistryLike,
  CustomEventStub,
  createContext,
  createIsolateEnvironment,
  DocumentStub,
  defaultDocumentStub,
  HTMLElementStub,
  HYDRATE_INTERNALS_ATTR_PREFIX,
  IntersectionObserverStub,
  IsolateCustomElementRegistry,
  type IsolateEnvironment,
  installIsolateGlobals,
  type KeyboardEventInitLike,
  KeyboardEventStub,
  MutationObserverStub,
  type ReactiveControllerLike,
  ResizeObserverStub,
  ShadowRootStub,
  withScopedIsolateGlobals,
} from './environment.js';
export {
  attachSsrToHtmlRewriter,
  createProgressiveDsdStream,
  type HtmlRewriterContentOptions,
  type HtmlRewriterDocumentEndLike,
  type HtmlRewriterDocumentHandler,
  type HtmlRewriterElementHandler,
  type HtmlRewriterElementLike,
  type HtmlRewriterEndTagLike,
  type HtmlRewriterIslandDefinition,
  type HtmlRewriterLike,
  type HtmlRewriterServerElementAdapter,
  HtmlRewriterSsrMultiplexer,
  type HtmlRewriterSsrOptions,
  transformWithHtmlRewriter,
} from './html-rewriter.js';
export { reflectedAttributeName } from './reflected-attributes.js';
export { renderHtmlDocument, renderToString, renderWithPendingBoundaries } from './render-api.js';
export { DEFAULT_BOUNDARY_TIMEOUT_MS } from './render-constants.js';
export type { RenderOptions } from './render-options.js';
export { createSsrRenderContext, render } from './renderer.js';
export { CSS_ADOPT_SCRIPT, formatAdoptedUrlFallbackScript, formatCssAdoptScript, formatSdsdBootstrapScript, formatSdsdTailChunk, SDSD_SWAP_SCRIPT } from './sdsd-scripts.js';
export { buildShadowStyleAndTemplateOpen } from './shadow-template.js';

export {
  distributeHostChildren,
  findMatchingCloseTag,
  type SlotDistribution,
  SlotManager,
  SlotProjectionContext,
  type SlottedNode,
  type SlottedOpcodeNode,
} from './slot.js';
export {
  createStreamFromAsyncIterator,
  createStreamFromIterator,
  type EdgeResponseOptions,
  renderToResponse,
  renderToStream,
  type StreamRenderOptions,
} from './stream.js';
