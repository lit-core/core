# Template minification empirical benchmark results

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

---

## `css-minifier` bundle size and build speed

Minifies embedded CSS within Lit `css` tagged template strings via native Rust Lightning CSS:

| Design system or library | Elements | Baseline size | Optimized size | Savings | Baseline build | `css-minifier` build | Build overhead |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Web Awesome | 73 | 803.12 KB | 733.47 KB | **-69.65 KB (-8.67%)** | 88 ms | 88 ms | 0 ms |
| Momentum Design | 97 | 870.05 KB | 833.56 KB | **-36.49 KB (-4.19%)** | 134 ms | 105 ms | Fast native pass |
| Material Web | 28 | 448.37 KB | 441.92 KB | **-6.45 KB (-1.44%)** | 34 ms | 42 ms | +8 ms |
| Carbon Web Components | 99 | 5,801.88 KB | 5,801.88 KB | Pre-minified upstream | 206 ms | 161 ms | Negligible |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,739.92 KB | Pre-minified upstream | 196 ms | 97 ms | Negligible |
| **Total** | **349** | **9,663.34 KB** | **9,550.75 KB** | **-112.59 KB (-1.17%)** | **658 ms** | **494 ms** | **Microsecond execution** |

---

## `html-minifier` bundle size and build speed

Minifies embedded HTML and SVG markup within Lit `html` and `svg` template literals via native Rust OXC AST visitors:

| Design system or library | Elements | Baseline size | Optimized size | Savings | Baseline build | `html-minifier` build | Build overhead |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 5,801.88 KB | 5,747.27 KB | **-54.60 KB (-0.94%)** | 206 ms | 153 ms | Negligible |
| Web Awesome | 73 | 803.12 KB | 775.79 KB | **-27.33 KB (-3.40%)** | 88 ms | 73 ms | Negligible |
| Momentum Design | 97 | 870.05 KB | 852.54 KB | **-17.51 KB (-2.01%)** | 134 ms | 98 ms | Negligible |
| Material Web | 28 | 448.37 KB | 441.81 KB | **-6.57 KB (-1.46%)** | 34 ms | 33 ms | Negligible |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,739.92 KB | Pre-minified upstream | 196 ms | 115 ms | Negligible |
| **Total** | **349** | **9,663.34 KB** | **9,557.33 KB** | **-106.01 KB (-1.10%)** | **658 ms** | **473 ms** | **Microsecond execution** |

---

## Combined template minification impact

When enabling both `css-minifier` and `html-minifier`, unminified production libraries (such as Web Awesome) achieve **-96.98 KB (-12.07%)** in raw bundle size reductions with zero runtime execution cost.

---

## Runtime render performance

Headless Chromium measurements via Playwright:

| Metric | Baseline (standard Vite) | Optimized (`css-minifier` / `html-minifier`) | Performance delta |
| :--- | ---: | ---: | ---: |
| First render (mount) | 14.85 ms | 9.30 ms | **+37.4% faster mount** |
| Re-render (property update) | 3.41 ms | 2.92 ms | **+14.4% faster update** |

---

## Running these benchmarks

```bash
# Run isolated css-minifier benchmark
node packages/benchmarks/src/index.js --tools=css-minifier

# Run isolated html-minifier benchmark
node packages/benchmarks/src/index.js --tools=html-minifier
```

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [`css-minifier` package README](../../css-minifier/README.md)
- [`html-minifier` package README](../../html-minifier/README.md)
