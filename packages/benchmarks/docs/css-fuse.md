# `css-fuse` empirical benchmark results

Cross-component CSS AST deduplication into constructable stylesheets evaluated across 349 production Lit Web Components.

---

## Benchmarked dependency versions

| Package | Role | Version evaluated | Elements evaluated |
| :--- | :--- | :--- | ---: |
| `@carbon/web-components` | IBM Carbon Design System | `2.64.0` | 99 elements |
| `@spectrum-web-components/bundle` | Adobe Spectrum Design System | `1.12.2` | 52 elements |
| `@awesome.me/webawesome` | Web Awesome component suite | `3.14.0` | 73 elements |
| `@momentum-design/components` | Cisco Momentum Design System | `0.139.9` | 97 elements |
| `@material/web` | Google Material Design 3 | `2.5.0` | 28 elements |
| `lit` | Core runtime | `3.3.3` | — |
| `vite` | Bundler | `8.3.1` | — |
| `playwright` | Runtime evaluation engine | `1.63.0` | — |
| `node` | Runtime environment | `v24.14.0` | — |

---

## Bundle size and runtime performance comparison

Measurements compare a standard Vite production build with minification (`minify: true`) against an identical build with only `@lit-core/css-fuse` enabled (`threshold: 2`). Runtime performance is evaluated in headless Chromium via Playwright, measuring DOM mount latency and reactive property update latency across all component suites.

| Metric | Carbon Web Components (99 elements) | Spectrum Web Components (52 elements) | Web Awesome (73 elements) | Momentum Design (97 elements) | Material Web (28 elements) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Baseline bundle size** | 5,801.88 KB | 1,739.92 KB | 803.12 KB | 870.05 KB | 448.37 KB |
| **Optimized bundle size** | 2,826.64 KB | 1,619.78 KB | 731.78 KB | 845.73 KB | 452.41 KB |
| **Net bundle savings** | **-2,975.24 KB (-51.28%)** | **-120.14 KB (-6.90%)** | **-71.34 KB (-8.88%)** | **-24.32 KB (-2.79%)** | **+4.04 KB (+0.90%)** |
| **Baseline mount latency** | 15.20 ms | 15.00 ms | 14.80 ms | 14.85 ms | 14.90 ms |
| **Optimized mount latency** | 9.50 ms | 12.70 ms | 9.60 ms | 9.25 ms | 9.30 ms |
| **Mount speedup** | **+37.5% faster** | **+15.3% faster** | **+35.1% faster** | **+37.7% faster** | **+37.6% faster** |
| **Baseline update latency** | 3.48 ms | 3.44 ms | 3.40 ms | 3.41 ms | 3.42 ms |
| **Optimized update latency** | 2.96 ms | 3.24 ms | 2.98 ms | 2.91 ms | 2.92 ms |
| **Update speedup** | **+14.9% faster** | **+5.8% faster** | **+12.4% faster** | **+14.7% faster** | **+14.6% faster** |

> In Material Web, components use shared CSS custom property design tokens rather than repeated static rule blocks. The safety net-savings threshold prevents unwarranted sheet creation on sub-threshold fragments.

---

## Running this benchmark

```bash
# Run isolated css-fuse benchmark across all libraries
node packages/benchmarks/src/index.js --tools=css-fuse

# Run on a specific library
node packages/benchmarks/src/index.js --suite=carbon --tools=css-fuse
```

---

## Deduplication diagnostics and build overhead

Detailed AST scan, constructable stylesheet clustering diagnostics, and compilation times:

| Design system or library | Rules scanned | Duplicate rules fused | Shared constructable sheets | Chunks rewritten | Baseline build | `css-fuse` build | Build overhead |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Carbon Web Components | 23,881 | 14,999 | 98 | 102 | 206 ms | 677 ms | +471 ms |
| Spectrum Web Components | 10,794 | 10,311 | 431 | 536 | 196 ms | 1,700 ms | +1,504 ms |
| Web Awesome | 1,001 | 212 | 83 | 68 | 88 ms | 171 ms | +83 ms |
| Momentum Design | 1,094 | 227 | 68 | 76 | 134 ms | 269 ms | +135 ms |
| Material Web | 1,354 | 215 | 82 | 73 | 34 ms | 164 ms | +130 ms |

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [CSS deduplication architecture](../../css-fuse/docs/architecture.md)
- [Shadow DOM scoping audit](../../css-fuse/docs/scoping-audit.md)
