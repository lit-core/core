# Template minifiers empirical benchmark results

Native Rust AST minification of embedded Lit `css\`...\`` and `html\`...\`` template literals via Lightning CSS and OXC, evaluated across 349 production Lit Web Components.

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

Measurements compare a standard Vite production build with minification (`minify: true`) against optimized builds with template minification enabled. Runtime performance is evaluated in headless Chromium via Playwright across all component suites.

| Metric | Carbon Web Components (99 elements) | Spectrum Web Components (52 elements) | Web Awesome (73 elements) | Momentum Design (97 elements) | Material Web (28 elements) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Baseline bundle size** | 5,801.88 KB | 1,739.92 KB | 803.12 KB | 870.05 KB | 448.37 KB |
| **`css-minifier` size** | 5,801.88 KB | 1,739.92 KB | 733.47 KB | 833.56 KB | 441.92 KB |
| **`css-minifier` savings** | Pre-minified upstream | Pre-minified upstream | **-69.65 KB (-8.67%)** | **-36.49 KB (-4.19%)** | **-6.45 KB (-1.44%)** |
| **`html-minifier` size** | 5,747.27 KB | 1,739.92 KB | 775.79 KB | 852.54 KB | 441.81 KB |
| **`html-minifier` savings** | **-54.60 KB (-0.94%)** | Pre-minified upstream | **-27.33 KB (-3.40%)** | **-17.51 KB (-2.01%)** | **-6.57 KB (-1.46%)** |
| **Combined minified size** | 5,747.27 KB | 1,739.92 KB | 706.14 KB | 816.05 KB | 435.35 KB |
| **Combined savings** | **-54.60 KB (-0.94%)** | Pre-minified upstream | **-96.98 KB (-12.07%)** | **-54.00 KB (-6.21%)** | **-13.02 KB (-2.90%)** |
| **Baseline mount latency** | 15.20 ms | 15.00 ms | 14.80 ms | 14.85 ms | 14.90 ms |
| **Optimized mount latency** | 9.45 ms | 12.70 ms | 9.30 ms | 9.20 ms | 9.20 ms |
| **Mount speedup** | **+37.8% faster** | **+15.3% faster** | **+37.2% faster** | **+38.0% faster** | **+38.3% faster** |
| **Baseline update latency** | 3.48 ms | 3.44 ms | 3.40 ms | 3.41 ms | 3.42 ms |
| **Optimized update latency** | 2.95 ms | 3.24 ms | 2.92 ms | 2.90 ms | 2.90 ms |
| **Update speedup** | **+15.2% faster** | **+5.8% faster** | **+14.1% faster** | **+15.0% faster** | **+15.2% faster** |

---

## Running these benchmarks

```bash
# Run isolated css-minifier benchmark
node packages/benchmarks/src/index.js --tools=css-minifier

# Run isolated html-minifier benchmark
node packages/benchmarks/src/index.js --tools=html-minifier
```

---

## Minification diagnostics and build overhead

Detailed template AST token counts and compilation times:

| Design system or library | CSS templates processed | HTML templates processed | Baseline build | `css-minifier` build | `html-minifier` build | Build overhead |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 596 | 206 ms | 161 ms | 153 ms | Negligible |
| Web Awesome | 73 | 200 | 88 ms | 88 ms | 73 ms | Negligible |
| Momentum Design | 97 | 79 | 134 ms | 105 ms | 98 ms | Negligible |
| Material Web | 28 | 187 | 34 ms | 42 ms | 33 ms | Negligible |
| Spectrum Web Components | 52 | 874 | 196 ms | 97 ms | 115 ms | Negligible |

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [`css-minifier` package README](../../css-minifier/README.md)
- [`html-minifier` package README](../../html-minifier/README.md)
