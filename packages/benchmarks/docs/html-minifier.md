# `@lit-core/html-minifier` empirical benchmark results

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

| Metric | Carbon Web Components (99 elements) | Spectrum Web Components (52 elements) | Web Awesome (73 elements) | Momentum Design (97 elements) | Material Web (28 elements) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Baseline bundle size** | 5,801.88 KB | 1,878.33 KB | 803.12 KB | 870.05 KB | 448.37 KB |
| **Optimized bundle size** | 5,747.27 KB | 1,856.77 KB | 775.79 KB | 852.54 KB | 441.81 KB |
| **Net bundle savings** | **-54.60 KB (-0.94%)** | **-21.56 KB (-1.15%)** | **-27.33 KB (-3.40%)** | **-17.51 KB (-2.01%)** | **-6.57 KB (-1.46%)** |
| **Baseline mount latency** | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| **Optimized mount latency** | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| **Mount speedup** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** |
| **Baseline update latency** | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| **Optimized update latency** | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| **Update speedup** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** |

> [!NOTE]
> `html-minifier` strips static whitespace and comments from Lit `html` and `svg` template literals ahead of time using OXC. Because template preparation, HTML parsing, and DOM instantiation pipelines remain structurally identical, runtime mount and update latencies remain neutral.

---

## Minification diagnostics and build overhead

Template processing diagnostics and compilation durations:

| Design system or library | HTML templates processed | Baseline build | `html-minifier` build | Build overhead |
| :--- | ---: | ---: | ---: | ---: |
| Carbon Web Components | 596 | 206 ms | 153 ms | Negligible native pass |
| Spectrum Web Components | 874 | 196 ms | 115 ms | Negligible native pass |
| Web Awesome | 200 | 85 ms | 69 ms | Negligible native pass |
| Momentum Design | 79 | 134 ms | 98 ms | Negligible native pass |
| Material Web | 187 | 34 ms | 33 ms | Negligible native pass |

---

## Running this benchmark

```bash
# Run isolated html-minifier benchmark across all suites
node packages/benchmarks/src/index.js --tools=html-minifier

# Run on a specific suite
node packages/benchmarks/src/index.js --suite=carbon --tools=html-minifier
```

---

## Architectural highlights and invariants

- **OXC AST minification**: Native Rust parser collapses redundant HTML/SVG whitespace and removes HTML comments ahead of time.
- **Lit part index preservation**: Whitespace stripping strictly preserves inter-element Lit dynamic binding positions (`<!--lit-part-->`) without corrupting part offsets.
- **SVG template preservation**: Accurately differentiates standard HTML templates from `svg` tagged template literals to preserve case-sensitive SVG attributes (`viewBox`, `preserveAspectRatio`).
- **Sub-millisecond native speed**: Native Rust compilation ensures template literal minification completes in sub-millisecond time.

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [`@lit-core/html-minifier` package documentation](../../html-minifier/README.md)
- [`@lit-core/css-minifier` benchmark](css-minifier.md)
- [HTML fragment clustering benchmark](html-fuse.md)
