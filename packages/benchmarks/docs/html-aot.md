# `html-aot` empirical benchmark results

Ahead-of-time (AOT) Lit template compilation eliminating runtime HTML parsing and template preparation, evaluated across 349 production Lit Web Components.

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

## Bundle size trade-off and build overhead

Ahead-of-time compilation pre-computes part bindings and template structures. While pre-computed metadata descriptors add a minor byte overhead (+1.85% across all 349 components), they completely eliminate the browser's runtime prepare phase:

| Design system or library | Elements | Baseline size | `html-aot` size | Size delta | Baseline build | `html-aot` build | Build overhead |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,740.01 KB | **+0.09 KB (+0.01%)** | 196 ms | 107 ms | Negligible |
| Material Web | 28 | 448.37 KB | 464.87 KB | **+16.50 KB (+3.68%)** | 34 ms | 197 ms | +163 ms |
| Web Awesome | 73 | 803.12 KB | 832.30 KB | **+29.17 KB (+3.63%)** | 88 ms | 550 ms | +462 ms |
| Momentum Design | 97 | 870.05 KB | 909.94 KB | **+39.89 KB (+4.58%)** | 134 ms | 442 ms | +308 ms |
| Carbon Web Components | 99 | 5,801.88 KB | 5,895.20 KB | **+93.33 KB (+1.61%)** | 206 ms | 841 ms | +635 ms |
| **Total** | **349** | **9,663.34 KB** | **9,842.32 KB** | **+178.98 KB (+1.85%)** | **658 ms** | **2,138 ms** | **+1,480 ms** |

---

## Runtime render speedup

Headless Chromium measurements via Playwright:

| Metric | Baseline (standard Vite) | Optimized (`html-aot`) | Performance delta |
| :--- | ---: | ---: | ---: |
| First render (mount) | 14.85 ms | 9.20 ms | **+38.0% faster mount** |
| Re-render (property update) | 3.41 ms | 2.90 ms | **+15.0% faster update** |
| Runtime template preparation | Required for every unique template | **Zero (0 ms)** | Runtime prepare phase eliminated |

---

## Running this benchmark

```bash
# Run isolated html-aot benchmark across all libraries
node packages/benchmarks/src/index.js --tools=html-aot

# Run on a specific library
node packages/benchmarks/src/index.js --suite=webawesome --tools=html-aot
```

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [AOT template compilation guide](../../html-aot/docs/template-compilation.md)
- [HTML fragment clustering guide](../../html-fuse/docs/fragment-clustering.md)
