export {
  type HtmlOptimizationResult,
  type OptimizationResult,
  shouldProcessFile,
  type TransformResult,
} from './common.js';
export { LIT_DIRECTIVES_FAST_CHECK, transformDirectivesPlugin } from './directives.js';
export { LIT_DIRTY_MASK_FAST_CHECK, transformDirtyMaskPlugin } from './dirty-mask.js';
export { LIT_DOM_PATHS_FAST_CHECK, transformDomPathsPlugin } from './dom-paths.js';
export { LIT_ELEM_PROXY_FAST_CHECK, transformElemProxy } from './elem-proxy.js';
export { LIT_EVENT_HOIST_FAST_CHECK, transformEventHoistPlugin } from './event-hoist.js';
export { runFuseOptimization, runHtmlFuseOptimization, runScopingAudit } from './fused.js';
export { transformHtmlAot } from './html-aot.js';
export { LIT_MEMOIZE_FAST_CHECK, transformMemoizePlugin } from './memoize.js';
export {
  LIT_CSS_FAST_CHECK,
  LIT_HTML_FAST_CHECK,
  transformCssMinifier,
  transformHtmlMinifier,
} from './minifiers.js';
export { LIT_NATIVE_FAST_CHECK, transformNativePlugin } from './native.js';
export { LIT_DECORATOR_FAST_CHECK, transformPropsLower } from './props-lower.js';
export { transformResumable } from './resumable.js';
export {
  scanAppTags,
  TAG_SHAKE_FAST_CHECK,
  transformTagShakePlugin,
} from './tag-shake.js';
