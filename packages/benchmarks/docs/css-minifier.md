# `css-minifier` empirical benchmark results

Native Rust AST minification of embedded Lit `css\`...\`` template literals via Lightning CSS, evaluated across 349 production Lit Web Components.

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

Measurements compare a standard Vite production build with minification (`minify: true`) against an identical build with `@lit-core/css-minifier` enabled. Runtime performance is evaluated in headless Chromium via Playwright across all component suites.

| Metric | Carbon Web Components (99 elements) | Spectrum Web Components (52 elements) | Web Awesome (73 elements) | Momentum Design (97 elements) | Material Web (28 elements) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Baseline bundle size** | 5801.88 KB | 1878.08 KB | 803.12 KB | 870.05 KB | 448.37 KB |
| **Optimized bundle size** | 5759.60 KB | 1877.23 KB | 733.47 KB | 833.56 KB | 441.92 KB |
| **Net bundle savings** | **-42.27 KB (-0.73%)** | **-0.84 KB (-0.04%)** | **-69.65 KB (-8.67%)** | **-36.49 KB (-4.19%)** | **-6.45 KB (-1.44%)** |
| **Baseline mount latency** | 15.12 ms | 15.12 ms | 14.80 ms | 14.84 ms | 14.88 ms |
| **Optimized mount latency** | 14.88 ms | 15.00 ms | 14.96 ms | 14.88 ms | 14.80 ms |
| **Mount speedup** | **+1.6% (neutral)** | **+0.8% (neutral)** | **-1.1% (neutral)** | **-0.3% (neutral)** | **+0.5% (neutral)** |
| **Baseline update latency** | 3.45 ms | 3.45 ms | 3.40 ms | 3.41 ms | 3.41 ms |
| **Optimized update latency** | 3.41 ms | 3.43 ms | 3.42 ms | 3.41 ms | 3.40 ms |
| **Update speedup** | **+1.2% (neutral)** | **+0.6% (neutral)** | **-0.6% (neutral)** | **+0.0% (neutral)** | **+0.3% (neutral)** |

> [!NOTE]
> `css-minifier` optimizes embedded CSS ASTs using Lightning CSS, removing comments, redundant whitespace, and duplicate declarations at build time. Because it does not alter stylesheet instantiation, DOM adoption, or the Lit rendering cycle, runtime mount and update latencies remain neutral.

---

## Running this benchmark

```bash
# Run isolated css-minifier benchmark across all suites
node packages/benchmarks/src/index.js --tools=css-minifier

# Run on a specific suite
node packages/benchmarks/src/index.js --suite=webawesome --tools=css-minifier
```

---

## Diagnostics and build overhead

Template processing diagnostics and compilation durations:

| Design system or library | CSS templates processed | Baseline build | `css-minifier` build | Build overhead |
| :--- | ---: | ---: | ---: | ---: |
| Web Awesome | 73 | 85 ms | 69 ms | Negligible native pass |
| Momentum Design | 97 | 134 ms | 105 ms | Negligible native pass |
| Material Web | 28 | 34 ms | 42 ms | +8 ms |
| Carbon Web Components | 99 | 206 ms | 161 ms | Negligible native pass |
| Spectrum Web Components | 52 | 196 ms | 97 ms | Negligible native pass |

---

## Related documentation

- [Benchmark suite overview](../README.md)
- [`@lit-core/css-minifier` package documentation](../../css-minifier/README.md)
- [`@lit-core/html-minifier` benchmark](html-minifier.md)
