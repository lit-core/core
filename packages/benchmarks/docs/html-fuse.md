# `html-fuse` empirical benchmark results

Cross-component static HTML and SVG template fragment clustering evaluated across 349 production Lit Web Components.

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

Measurements compare a standard Vite production build against an identical build with only `@lit-core/html-fuse` enabled (`threshold: 2`, `minFragmentLength: 15`).

| Design system or library | Elements | Baseline size | Optimized size | Net savings | Baseline build | `html-fuse` build | Build overhead |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,736.80 KB | **-3.12 KB (-0.18%)** | 196 ms | 449 ms | +253 ms |
| Carbon Web Components | 99 | 5,801.88 KB | 5,799.20 KB | **-2.68 KB (-0.05%)** | 206 ms | 254 ms | +48 ms |
| Material Web | 28 | 448.37 KB | 446.99 KB | **-1.38 KB (-0.31%)** | 34 ms | 59 ms | +25 ms |
| Web Awesome | 73 | 803.12 KB | 801.80 KB | **-1.33 KB (-0.17%)** | 88 ms | 133 ms | +45 ms |
| Momentum Design | 97 | 870.05 KB | 869.70 KB | **-0.35 KB (-0.04%)** | 134 ms | 161 ms | +27 ms |
| **Total** | **349** | **9,663.34 KB** | **9,654.48 KB** | **-8.86 KB (-0.09%)** | **658 ms** | **1,056 ms** | **+398 ms** |

---

## Fragment clustering diagnostics

Detailed AST scan and static subtree clustering diagnostics:

| Design system or library | Fragments scanned | Duplicate fragments fused | Shared template constants | Components rewritten |
| :--- | ---: | ---: | ---: | ---: |
| **Spectrum Web Components** | 874 | 160 | 120 | 108 |
| **Carbon Web Components** | 596 | 35 | 19 | 32 |
| **Web Awesome** | 200 | 31 | 14 | 23 |
| **Material Web** | 187 | 29 | 11 | 27 |
| **Momentum Design** | 79 | 16 | 8 | 12 |
| **Total** | **1,936** | **271** | **172** | **202** |

---

## Runtime render performance

Headless Chromium measurements via Playwright:

| Metric | Baseline (standard Vite) | Optimized (`html-fuse`) | Performance delta |
| :--- | ---: | ---: | ---: |
| First render (mount) | 14.85 ms | 9.45 ms | **+36.4% faster mount** |
| Re-render (property update) | 3.41 ms | 2.95 ms | **+13.5% faster update** |
| `innerHTML` parsing calls | Duplicate per component | 1 parse per shared template | **Consolidated template caching** |

---

## Running this benchmark

```bash
# Run isolated html-fuse benchmark across all libraries
node packages/benchmarks/src/index.js --tools=html-fuse

# Run on a specific library
node packages/benchmarks/src/index.js --suite=webawesome --tools=html-fuse
```

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [Fragment clustering guide](../../html-fuse/docs/fragment-clustering.md)
