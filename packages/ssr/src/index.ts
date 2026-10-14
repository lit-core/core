/**
 * @lit-core/ssr
 * Universal ahead-of-time server-side rendering engine for Lit and Web Components
 * emitting clean Declarative Shadow DOM with zero comment markers.
 */

export {
  type CompiledTemplateDescriptor,
  type CompiledTemplatePart,
  type CompiledTemplateResult,
  CompilerBridge,
  type ExtractedStyles,
  escapeAttribute,
  escapeHtml,
  isCompiledTemplateResult,
  isStandardTemplateResult,
  LIT_NO_CHANGE,
  LIT_NOTHING,
  PreparedChunkPlan,
  resolveDirectiveValue,
  type SsrRenderContext,
  StyleDeduplicator,
} from './compiler-bridge.js';
export {
  CSSStyleSheetStub,
  type CustomElementRegistryLike,
  CustomEventStub,
  createIsolateEnvironment,
  DocumentStub,
  defaultDocumentStub,
  HTMLElementStub,
  IsolateCustomElementRegistry,
  installIsolateGlobals,
  type KeyboardEventInitLike,
  KeyboardEventStub,
  ShadowRootStub,
} from './environment.js';
export {
  collectResult,
  type RenderOptions,
  render,
  renderToString,
} from './renderer.js';

export {
  extractNameFromSlotTag,
  extractSlotNameFromTag,
  parseAttributes,
  projectSlots,
  type SlotDistribution,
  SlotManager,
  SlotProjectionContext,
  type SlottedNode,
} from './slot.js';
export {
  createStreamFromIterator,
  renderToStream,
  type StreamRenderOptions,
} from './stream.js';
