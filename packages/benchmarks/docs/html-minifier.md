# `html-minifier` empirical benchmark results

Native Rust AST minification of embedded Lit `html\`...\`` and `svg\`...\`` template literals via OXC, evaluated across 349 production Lit Web Components.

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

Measurements compare a standard Vite production build with minification (`minify: true`) against an identical build with `@lit-core/html-minifier` enabled. Runtime performance is evaluated in headless Chromium via Playwright across all component suites.

| Metric | Carbon Web Components (99 elements) | Web Awesome (73 elements) | Momentum Design (97 elements) | Material Web (28 elements) | Spectrum Web Components (52 elements) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Baseline bundle size** | 5,801.88 KB | 803.12 KB | 870.05 KB | 448.37 KB | 1,739.92 KB |
| **Optimized bundle size** | 5,747.27 KB | 775.79 KB | 852.54 KB | 441.81 KB | 1,739.92 KB |
| **Net bundle savings** | **-54.60 KB (-0.94%)** | **-27.33 KB (-3.40%)** | **-17.51 KB (-2.01%)** | **-6.57 KB (-1.46%)** | Pre-minified upstream |
| **Baseline mount latency** | 15.12 ms | 14.80 ms | 14.85 ms | 14.90 ms | 14.96 ms |
| **Optimized mount latency** | 8.30 ms | 8.18 ms | 8.22 ms | 8.50 ms | 13.48 ms |
| **Mount speedup** | **+45.1% faster** | **+44.7% faster** | **+44.6% faster** | **+42.9% faster** | **+9.9% faster** |
| **Baseline update latency** | 3.45 ms | 3.40 ms | 3.41 ms | 3.42 ms | 3.42 ms |
| **Optimized update latency** | 2.51 ms | 2.49 ms | 2.49 ms | 2.54 ms | 3.22 ms |
| **Update speedup** | **+27.2% faster** | **+26.8% faster** | **+27.0% faster** | **+25.7% faster** | **+5.8% faster** |

---

## Running this benchmark

```bash
# Run isolated html-minifier benchmark across all suites
node packages/benchmarks/src/index.js --tools=html-minifier

# Run on a specific suite
node packages/benchmarks/src/index.js --suite=carbon --tools=html-minifier
```

---

## Diagnostics and build overhead

Template processing diagnostics and compilation durations:

| Design system or library | HTML templates processed | Baseline build | `html-minifier` build | Build overhead |
| :--- | ---: | ---: | ---: | ---: |
| Carbon Web Components | 596 | 206 ms | 153 ms | Negligible native pass |
| Web Awesome | 200 | 85 ms | 69 ms | Negligible native pass |
| Momentum Design | 79 | 134 ms | 98 ms | Negligible native pass |
| Material Web | 187 | 34 ms | 33 ms | Negligible native pass |
| Spectrum Web Components | 874 | 196 ms | 115 ms | Negligible native pass |

---

## Related documentation

- [Benchmark suite overview](../README.md)
- [`@lit-core/html-minifier` package documentation](../../html-minifier/README.md)
- [`@lit-core/css-minifier` benchmark](css-minifier.md)
