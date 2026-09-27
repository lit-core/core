# `elem-proxy` empirical benchmark results

Deferred Custom Element proxy stubs evaluated across production Lit design systems to measure script evaluation CPU time, V8 heap memory footprint, and mount latency.

---

## Benchmarked dependency versions

| Package | Role | Version evaluated | Elements evaluated |
| :--- | :--- | :--- | ---: |
| `@carbon/web-components` | IBM Carbon Design System | `2.64.0` | 99 elements |
| `@spectrum-web-components/bundle` | Adobe Spectrum Design System | `1.12.2` | 52 elements |
| `lit` | Core runtime | `3.3.3` | — |
| `vite` | Bundler | `8.3.1` | — |
| `node` | Runtime environment | `v24.14.0` | — |

---

## Runtime initialization and memory savings

Measurements evaluate executing full design system bundles in an isolated V8 VM context, comparing eager class evaluation against proxy stubs that defer class definition until elements are mounted:

### Carbon Web Components (99 components)

| Metric | Baseline (eager evaluation) | Optimized (`elem-proxy`) | Delta / savings |
| :--- | ---: | ---: | ---: |
| Script evaluation time | 114.21 ms | 31.07 ms | **-72.8% CPU time (-83.14 ms)** |
| V8 heap memory footprint | 148,462.0 KB | 48,364.2 KB | **-67.4% memory (-100,097.8 KB)** |
| Mount latency (first 5 components) | 1.90 ms | 2.80 ms | +0.90 ms (transparent JIT upgrade) |
| Classes evaluated during init | 99 / 99 (100.0%) | 5 / 99 (5.1%) | **-94 classes avoided at boot** |
| Deferred execution savings | 0 / 99 (0.0%) | 94 / 99 (94.9%) | **+94.9% deferred execution** |

### Spectrum Web Components (52 components)

| Metric | Baseline (eager evaluation) | Optimized (`elem-proxy`) | Delta / savings |
| :--- | ---: | ---: | ---: |
| Script evaluation time | 48.64 ms | 13.98 ms | **-71.3% CPU time (-34.66 ms)** |
| V8 heap memory footprint | 197,775.7 KB | 58,914.2 KB | **-70.2% memory (-138,861.5 KB)** |
| Mount latency (first 5 components) | 1.90 ms | 2.80 ms | +0.90 ms (transparent JIT upgrade) |
| Classes evaluated during init | 52 / 52 (100.0%) | 5 / 52 (9.6%) | **-47 classes avoided at boot** |
| Deferred execution savings | 0 / 52 (0.0%) | 47 / 52 (90.4%) | **+90.4% deferred execution** |

---

## Static build overhead

Build time comparison during Vite production bundling:

| Suite | Elements | Baseline build | `elem-proxy` build | Overhead |
| :--- | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 206 ms | 144 ms | Fast AST pass (proxy stubs replace eager decorators) |
| Spectrum Web Components | 52 | 196 ms | 106 ms | Fast AST pass |
| Web Awesome | 73 | 88 ms | 77 ms | Negligible overhead |
| Total (all 5 suites) | 349 | 658 ms | 456 ms | Microsecond-level AST rewrites via OXC |

---

## Running this benchmark

```bash
# Run the standalone elem-proxy runtime initialization harness
pnpm run benchmark:elem-proxy

# Or directly:
node packages/benchmarks/src/elem-proxy-bench.js
```

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [Deferred proxy architecture](../../elem-proxy/docs/proxy-architecture.md)
- [Props lowering mechanics](../../props-lower/docs/transform-mechanics.md)
