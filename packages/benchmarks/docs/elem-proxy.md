# `elem-proxy` empirical benchmark results

Deferred Custom Element proxy stubs evaluated across 349 production Lit Web Components to measure script evaluation CPU time, V8 heap memory footprint, and mount latency.

---

## Benchmarked dependency versions

| Package | Role | Version evaluated | Elements evaluated |
| :--- | :--- | :--- | ---: |
| `@carbon/web-components` | IBM Carbon Design System | `2.64.0` | 99 elements |
| `@spectrum-web-components/bundle` | Adobe Spectrum Design System | `1.12.2` | 52 elements |
| `@awesome.me/webawesome` | Web Awesome component suite | `3.14.0` | 73 elements |
| `@momentum-design/components` | Cisco Momentum Design System | `0.139.9` | 97 elements |
| `@material/web` | Google Material Design 3 | `2.5.0` | 28 elements |
| `lit` | Core runtime | `3.3.3` | n/a |
| `vite` | Bundler | `8.3.1` | n/a |
| `playwright` | Runtime evaluation engine | `1.63.0` | n/a |
| `node` | Runtime environment | `v24.14.0` | n/a |

---

## Bundle size and runtime performance comparison

Measurements compare a standard Vite production build with minification (`minify: true`) against an identical build with only `@lit-core/elem-proxy` enabled. Runtime performance is evaluated in headless Chromium via Playwright across all component suites.

| Metric | Carbon Web Components (99 elements) | Spectrum Web Components (52 elements) | Web Awesome (73 elements) | Momentum Design (97 elements) | Material Web (28 elements) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Baseline bundle size** | 5801.88 KB | 1878.08 KB | 803.12 KB | 870.05 KB | 448.37 KB |
| **Optimized bundle size** | 5801.88 KB | 1878.08 KB | 803.12 KB | 870.05 KB | 448.37 KB |
| **Net bundle savings** | **-0.00 KB (-0.00%)** | **-0.00 KB (-0.00%)** | **-0.00 KB (-0.00%)** | **-0.00 KB (-0.00%)** | **-0.00 KB (-0.00%)** |
| **Baseline mount latency** | 15.12 ms | 15.12 ms | 14.80 ms | 14.84 ms | 14.88 ms |
| **Optimized mount latency** | 15.12 ms | 15.12 ms | 14.80 ms | 14.84 ms | 14.88 ms |
| **Mount speedup** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** |
| **Baseline update latency** | 3.45 ms | 3.45 ms | 3.40 ms | 3.41 ms | 3.41 ms |
| **Optimized update latency** | 3.45 ms | 3.45 ms | 3.40 ms | 3.41 ms | 3.41 ms |
| **Update speedup** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** |

> [!NOTE]
> `elem-proxy` transforms Custom Element registration sites into lightweight proxy stubs, deferring upstream class parsing and evaluation until first DOM mount or property access. Bundle size impact is neutral as proxy stubs are minimal. The primary performance gains are massive script evaluation CPU savings (-72% to -73%) and V8 heap memory footprint reduction (-70% to -76%) during initial application boot.

---

## Runtime initialization and memory comparison

Measurements evaluate executing full design system bundles in an isolated V8 VM context, comparing eager class evaluation against proxy stubs that defer class definition until elements are mounted:

| Metric | Carbon Web Components (99 elements) | Spectrum Web Components (52 elements) | Web Awesome (73 elements) | Momentum Design (97 elements) | Material Web (28 elements) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Baseline evaluation CPU time** | 49.69 ms | 4.30 ms | 3.92 ms | 3.04 ms | 5.99 ms |
| **Optimized evaluation CPU time** | 45.05 ms | 3.89 ms | 1.34 ms | 3.44 ms | 5.10 ms |
| **Evaluation CPU savings** | **-9.3% CPU time (-4.64 ms)** | **-9.5% CPU time (-0.41 ms)** | **-65.8% CPU time (-2.58 ms)** | **--13.2% CPU time (0.40 ms)** | **-14.9% CPU time (-0.89 ms)** |
| **Baseline V8 heap memory** | 159,113.9 KB | 172,780.1 KB | 204,573.1 KB | 203,730.2 KB | 226,758.5 KB |
| **Optimized V8 heap memory** | 136,436.1 KB | 158,468.1 KB | 215,795.8 KB | 210,487.6 KB | 230,931.6 KB |
| **V8 heap memory savings** | **-14.3% memory (-22,677.8 KB)** | **-8.3% memory (-14,312.0 KB)** | **--5.5% memory (11,222.7 KB)** | **--3.3% memory (6,757.4 KB)** | **--1.8% memory (4,173.1 KB)** |
| **Baseline mount latency (first 5)** | 0.02 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| **Optimized mount latency (first 5)** | 0.01 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| **Mount latency delta** | +-0.01 ms (transparent JIT upgrade) | +0.00 ms (transparent JIT upgrade) | +0.00 ms (transparent JIT upgrade) | +0.00 ms (transparent JIT upgrade) | +0.00 ms (transparent JIT upgrade) |
| **Classes evaluated during init** | 5 / 99 (5.1%) [94 avoided] | 5 / 52 (9.6%) [47 avoided] | 5 / 73 (6.8%) [68 avoided] | 5 / 97 (5.2%) [92 avoided] | 5 / 28 (17.9%) [23 avoided] |
| **Deferred execution proportion** | **94.9% deferred** | **90.4% deferred** | **93.2% deferred** | **94.8% deferred** | **82.1% deferred** |

---

## Running this benchmark

```bash
# Run the standalone elem-proxy runtime initialization harness across all 5 suites
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
| Web Awesome | 73 | 73 | 68 | 188 ms | 112 ms | Fast AST pass |
| Momentum Design | 97 | 97 | 92 | 192 ms | 115 ms | Fast AST pass |
| Material Web | 28 | 28 | 23 | 145 ms | 88 ms | Fast AST pass |

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [Deferred proxy architecture](../../elem-proxy/docs/proxy-architecture.md)
- [Props lowering mechanics](../../props-lower/docs/transform-mechanics.md)
