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

---

## Bundle size and build overhead

Measurements compare a standard Vite production build with minification (`minify: true`) against an identical build with only `@lit-core/css-fuse` enabled (`threshold: 2`).

| Design system or library | Elements | Baseline size | Optimized size | Net savings | Baseline build | `css-fuse` build | Build overhead |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 5,801.88 KB | 2,826.64 KB | **-2,975.24 KB (-51.28%)** | 206 ms | 677 ms | +471 ms |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,619.78 KB | **-120.14 KB (-6.90%)** | 196 ms | 1,700 ms | +1,504 ms |
| Web Awesome | 73 | 803.12 KB | 731.78 KB | **-71.34 KB (-8.88%)** | 88 ms | 171 ms | +83 ms |
| Momentum Design | 97 | 870.05 KB | 845.73 KB | **-24.32 KB (-2.79%)** | 134 ms | 269 ms | +135 ms |
| Material Web | 28 | 448.37 KB | 452.41 KB | **+4.04 KB (+0.90%)** | 34 ms | 164 ms | +130 ms |
| **Total** | **349** | **9,663.34 KB** | **6,476.34 KB** | **-3,186.99 KB (-32.98%)** | **658 ms** | **2,981 ms** | **+2,323 ms** |

> In Material Web, components use shared CSS custom property design tokens rather than repeated static rule blocks. The safety net-savings threshold prevents unwarranted sheet creation on sub-threshold fragments.

---

## Deduplication diagnostics

Detailed AST scan and constructable stylesheet clustering diagnostics:

| Design system or library | Rules scanned | Duplicate rules fused | Shared constructable sheets | Chunks rewritten |
| :--- | ---: | ---: | ---: | ---: |
| **Carbon Web Components** | 23,881 | 14,999 | 98 | 102 |
| **Spectrum Web Components** | 10,794 | 10,311 | 431 | 536 |
| **Material Web** | 1,354 | 215 | 82 | 73 |
| **Momentum Design** | 1,094 | 227 | 68 | 76 |
| **Web Awesome** | 1,001 | 212 | 83 | 68 |
| **Total** | **38,124** | **25,964** | **762** | **855** |

---

## Runtime render performance

Headless Chromium measurements via Playwright:

| Metric | Baseline (standard Vite) | Optimized (`css-fuse`) | Performance delta |
| :--- | ---: | ---: | ---: |
| First render (mount) | 14.85 ms | 9.25 ms | **+37.7% faster mount** |
| Re-render (property update) | 3.41 ms | 2.91 ms | **+14.7% faster update** |
| In-memory `CSSStyleSheet` instances | 349 instances | 83 shared + unique | **-76.2% stylesheet objects** |

---

## Running this benchmark

```bash
# Run isolated css-fuse benchmark across all libraries
node packages/benchmarks/src/index.js --tools=css-fuse

# Run on a specific library
node packages/benchmarks/src/index.js --suite=carbon --tools=css-fuse
```

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [CSS deduplication architecture](../../css-fuse/docs/architecture.md)
- [Shadow DOM scoping audit](../../css-fuse/docs/scoping-audit.md)
