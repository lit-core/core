export { runDirectivesBenchmarks } from './directives.js';
export { runDirtyMaskBenchmarks } from './dirty-mask.js';
export { runDomPathsBenchmarks } from './dom-paths.js';
export { runElemProxyBenchmarks } from './elem-proxy.js';
export { runEventHoistBenchmarks } from './event-hoist.js';
export { runMemoizeBenchmarks } from './memoize.js';
export { runNativeBenchmarkSuite } from './native.js';
export {
  cleanTemplateForDsd,
  getSemanticFallback,
  measureResumablePerformance,
  runResumableBenchmark,
  SUITES as RESUMABLE_SUITES,
} from './resumable.js';
export { runSsrBenchmarks, SSR_SUITES } from './ssr.js';
export { runTagShakeBenchmarks, SUITE_LABELS as TAG_SHAKE_SUITE_LABELS } from './tag-shake.js';
