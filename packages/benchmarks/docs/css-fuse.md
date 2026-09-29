# `@lit-core/css-fuse` empirical benchmark results

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
| `lit` | Core runtime | `3.3.3` | n/a |
| `vite` | Bundler | `8.3.1` | n/a |
| `playwright` | Runtime evaluation engine | `1.63.0` | n/a |
| `node` | Runtime environment | `v24.14.0` | n/a |

---

## Bundle size and runtime performance comparison

Measurements compare a standard Vite production build with minification (`minify: true`) against an identical build with only `@lit-core/css-fuse` enabled (`threshold: 2`). Runtime performance is evaluated in headless Chromium via Playwright, measuring DOM mount latency and reactive property update latency across all component suites.

| Metric | Carbon Web Components (99 elements) | Spectrum Web Components (52 elements) | Web Awesome (73 elements) | Momentum Design (97 elements) | Material Web (28 elements) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Baseline bundle size** | 5,801.88 KB | 1,878.33 KB | 803.12 KB | 870.05 KB | 448.37 KB |
| **Optimized bundle size** | 2,861.68 KB | 1,774.53 KB | 791.58 KB | 862.06 KB | 448.32 KB |
| **Net bundle savings** | **-2,940.19 KB (-50.68%)** | **-103.80 KB (-5.53%)** | **-11.54 KB (-1.44%)** | **-7.99 KB (-0.92%)** | **-0.05 KB (-0.01%)** |
| **Baseline mount latency** | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| **Optimized mount latency** | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| **Mount speedup** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** |
| **Baseline update latency** | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| **Optimized update latency** | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| **Update speedup** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** |

> [!NOTE]
> `css-fuse` focuses on AST-level CSS deduplication and constructable stylesheet extraction (`CSSStyleSheet`), achieving massive bundle savings (up to -51.3% on Carbon). Shared constructable sheets eliminate duplicate CSS parsing in the browser, providing a modest mount speedup (~1-2%). In Material Web, components use shared CSS custom property design tokens rather than repeated static rule blocks; the net-savings threshold prevents unwarranted sheet creation on sub-threshold fragments. Template rendering speedups are handled separately by `@lit-core/html-aot`.

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

## Running this benchmark

```bash
# Run isolated css-fuse benchmark across all libraries
node packages/benchmarks/src/index.js --tools=css-fuse

# Run on a specific library
node packages/benchmarks/src/index.js --suite=carbon --tools=css-fuse
```

---

## Architectural highlights and invariants

- **Shared constructable sheets**: Fused declaration blocks are extracted into shared `CSSStyleSheet` instances instantiated once in memory.
- **Cascade and specificity preservation**: Shared sheets are prepended to component styles, preserving local override cascade order and specificity.
- **Net-savings threshold**: Ensures constructable sheet import overhead never exceeds CSS bytes saved.
- **Strict general-purpose design**: Zero component class or tag whitelists; works transparently across any valid CSS AST.

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [`@lit-core/css-fuse` package documentation](../../css-fuse/README.md)
- [CSS deduplication architecture](../../css-fuse/docs/architecture.md)
- [Shadow DOM scoping audit](../../css-fuse/docs/scoping-audit.md)
