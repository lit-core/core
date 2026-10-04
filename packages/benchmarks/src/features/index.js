export { runDirectivesBenchmarks, SUITE_LABELS as DIRECTIVES_SUITE_LABELS } from './directives.js';
export { ENTERPRISE_SUITES as DIRTY_MASK_SUITES, runDirtyMaskBenchmarks } from './dirty-mask.js';
export { ENTERPRISE_SUITES as DOM_PATHS_SUITES, runDomPathsBenchmarks } from './dom-paths.js';
export { runElemProxyBenchmarks } from './elem-proxy.js';
export { runEventHoistBenchmarks, SUITE_LABELS as EVENT_HOIST_SUITE_LABELS } from './event-hoist.js';
export { ENTERPRISE_COLLECTIONS as MEMOIZE_COLLECTIONS, runMemoizeBenchmarks } from './memoize.js';
export { runNativeBenchmarkSuite } from './native.js';
export {
  cleanTemplateForDsd,
  getSemanticFallback,
  measureResumablePerformance,
  runResumableBenchmark,
  SUITES as RESUMABLE_SUITES,
} from './resumable.js';
export { runTagShakeBenchmarks, SUITE_LABELS as TAG_SHAKE_SUITE_LABELS } from './tag-shake.js';
