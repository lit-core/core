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
| `playwright` | Runtime evaluation engine | `1.63.0` | — |
| `node` | Runtime environment | `v24.14.0` | — |

---

## Bundle size and runtime performance comparison

Ahead-of-time compilation pre-computes part bindings and template structures. While pre-computed metadata descriptors add a minor byte overhead (+1.85% across all 349 components), they completely eliminate the browser's runtime prepare phase, delivering notable render speedups:

| Metric | Carbon Web Components (99 elements) | Spectrum Web Components (52 elements) | Web Awesome (73 elements) | Momentum Design (97 elements) | Material Web (28 elements) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Baseline bundle size** | 5,801.88 KB | 1,739.92 KB | 803.12 KB | 870.05 KB | 448.37 KB |
| **Optimized bundle size** | 5,895.20 KB | 1,740.01 KB | 832.30 KB | 909.94 KB | 464.87 KB |
| **Net bundle size delta** | **+93.33 KB (+1.61%)** | **+0.09 KB (+0.01%)** | **+29.17 KB (+3.63%)** | **+39.89 KB (+4.58%)** | **+16.50 KB (+3.68%)** |
| **Baseline mount latency** | 15.20 ms | 15.00 ms | 14.80 ms | 14.85 ms | 14.90 ms |
| **Optimized mount latency** | 9.40 ms | 12.60 ms | 9.45 ms | 9.20 ms | 9.60 ms |
| **Mount speedup** | **+38.2% faster** | **+16.0% faster** | **+36.1% faster** | **+38.0% faster** | **+35.6% faster** |
| **Baseline update latency** | 3.48 ms | 3.44 ms | 3.40 ms | 3.41 ms | 3.42 ms |
| **Optimized update latency** | 2.94 ms | 3.22 ms | 2.95 ms | 2.90 ms | 2.98 ms |
| **Update speedup** | **+15.5% faster** | **+6.4% faster** | **+13.2% faster** | **+15.0% faster** | **+12.9% faster** |

---

## Running this benchmark

```bash
# Run isolated html-aot benchmark across all libraries
node packages/benchmarks/src/index.js --tools=html-aot

# Run on a specific library
node packages/benchmarks/src/index.js --suite=webawesome --tools=html-aot
```

---

## Compilation diagnostics and build overhead

Detailed template descriptor counts and compilation times:

| Design system or library | Templates compiled | Parts pre-computed | Runtime prepare calls | Baseline build | `html-aot` build | Build overhead |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Carbon Web Components | 214 | 1,482 | 0 (eliminated) | 206 ms | 841 ms | +635 ms |
| Web Awesome | 146 | 988 | 0 (eliminated) | 88 ms | 550 ms | +462 ms |
| Momentum Design | 182 | 1,120 | 0 (eliminated) | 134 ms | 442 ms | +308 ms |
| Material Web | 72 | 496 | 0 (eliminated) | 34 ms | 197 ms | +163 ms |
| Spectrum Web Components | 96 | 684 | 0 (eliminated) | 196 ms | 107 ms | Negligible |

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [AOT template compilation guide](../../html-aot/docs/template-compilation.md)
- [HTML fragment clustering guide](../../html-fuse/docs/fragment-clustering.md)
