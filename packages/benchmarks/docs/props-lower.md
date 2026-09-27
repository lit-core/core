# `props-lower` empirical benchmark results

Ahead-of-time (AOT) lowering of Lit TypeScript decorators (`@customElement`, `@property`, `@state`, `@query`) to static properties via native Rust and OXC, evaluated across 349 production Lit Web Components.

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

Measurements compare a standard Vite production build with minification (`minify: true`) against an identical build with only `@lit-core/props-lower` enabled. Runtime performance is evaluated in headless Chromium via Playwright across all component suites.

| Metric | Carbon Web Components (99 elements) | Spectrum Web Components (52 elements) | Web Awesome (73 elements) | Momentum Design (97 elements) | Material Web (28 elements) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Baseline bundle size** | 5801.88 KB | 1878.08 KB | 803.12 KB | 870.05 KB | 448.37 KB |
| **Optimized bundle size** | 5796.44 KB | 1877.85 KB | 807.24 KB | 813.11 KB | 452.87 KB |
| **Net bundle savings** | **-5.44 KB (-0.09%)** | **-0.23 KB (-0.01%)** | **+4.12 KB (+0.51%)** | **-56.94 KB (-6.54%)** | **+4.50 KB (+1.00%)** |
| **Baseline mount latency** | 15.12 ms | 15.12 ms | 14.80 ms | 14.84 ms | 14.88 ms |
| **Optimized mount latency** | 14.88 ms | 14.92 ms | 15.04 ms | 15.04 ms | 14.80 ms |
| **Mount speedup** | **+1.6% (neutral)** | **+1.3% (neutral)** | **-1.6% (neutral)** | **-1.3% (neutral)** | **+0.5% (neutral)** |
| **Baseline update latency** | 3.45 ms | 3.45 ms | 3.40 ms | 3.41 ms | 3.41 ms |
| **Optimized update latency** | 3.41 ms | 3.42 ms | 3.44 ms | 3.44 ms | 3.40 ms |
| **Update speedup** | **+1.2% (neutral)** | **+0.9% (neutral)** | **-1.2% (neutral)** | **-0.9% (neutral)** | **+0.3% (neutral)** |

> [!NOTE]
> `props-lower` lowers TypeScript/TC39 decorators into standard Lit static `properties` fields ahead of time using OXC, eliminating runtime decorator polyfill helpers and decorator execution overhead during script evaluation. Because component template creation and DOM mounting are handled by Lit's template renderer, runtime mount speedups are modest (~1-2%). Ahead-of-time template rendering speedups are handled separately by `@lit-core/html-aot`.

---

## Running this benchmark

```bash
# Run isolated props-lower benchmark across all libraries
node packages/benchmarks/src/index.js --tools=props-lower

# Run on a specific library
node packages/benchmarks/src/index.js --suite=spectrum --tools=props-lower
```

---

## Lowering diagnostics and build overhead

Detailed class transformation metrics and compilation times:

| Design system or library | Classes lowered | Decorators stripped | Reflection helpers removed | Baseline build | `props-lower` build | Build overhead |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Spectrum Web Components | 52 | 248 | Complete removal | 196 ms | 109 ms | Fast native pass |
| Carbon Web Components | 99 | 412 | Complete removal | 206 ms | 289 ms | +83 ms |
| Momentum Design | 97 | 386 | Complete removal | 134 ms | 101 ms | Fast native pass |
| Web Awesome | 73 | 315 | Complete removal | 88 ms | 74 ms | Fast native pass |
| Material Web | 28 | 134 | Complete removal | 34 ms | 42 ms | +8 ms |

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [Decorator lowering mechanics](../../props-lower/docs/transform-mechanics.md)
- [Deferred proxy architecture](../../elem-proxy/docs/proxy-architecture.md)
