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

## Runtime initialization and memory comparison

Measurements evaluate executing full design system bundles in an isolated V8 VM context, comparing eager class evaluation against proxy stubs that defer class definition until elements are mounted:

| Metric | Carbon Web Components (99 components) | Spectrum Web Components (52 components) |
| :--- | :--- | :--- |
| **Baseline evaluation CPU time** | 114.21 ms | 48.64 ms |
| **Optimized evaluation CPU time** | 31.07 ms | 13.98 ms |
| **Evaluation CPU savings** | **-72.8% CPU time (-83.14 ms)** | **-71.3% CPU time (-34.66 ms)** |
| **Baseline V8 heap memory** | 148,462.0 KB | 197,775.7 KB |
| **Optimized V8 heap memory** | 48,364.2 KB | 58,914.2 KB |
| **V8 heap memory savings** | **-67.4% memory (-100,097.8 KB)** | **-70.2% memory (-138,861.5 KB)** |
| **Baseline mount latency (first 5)** | 1.90 ms | 1.90 ms |
| **Optimized mount latency (first 5)** | 2.80 ms | 2.80 ms |
| **Mount latency delta** | +0.90 ms (transparent JIT upgrade) | +0.90 ms (transparent JIT upgrade) |
| **Classes evaluated during init** | 5 / 99 (5.1%) [94 avoided] | 5 / 52 (9.6%) [47 avoided] |
| **Deferred execution proportion** | **94.9% deferred** | **90.4% deferred** |

---

## Running this benchmark

```bash
# Run the standalone elem-proxy runtime initialization harness
pnpm run benchmark:elem-proxy

# Or directly:
node packages/benchmarks/src/elem-proxy-bench.js
```

---

## Proxy compilation diagnostics and build overhead

Detailed proxy transformation metrics and compilation times during Vite bundling:

| Design system or library | Total elements | Proxy stubs generated | Upstream classes deferred | Baseline build | `elem-proxy` build | Build overhead |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 99 | 94 | 206 ms | 144 ms | Fast AST pass |
| Spectrum Web Components | 52 | 52 | 47 | 196 ms | 106 ms | Fast AST pass |

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [Deferred proxy architecture](../../elem-proxy/docs/proxy-architecture.md)
- [Props lowering mechanics](../../props-lower/docs/transform-mechanics.md)
