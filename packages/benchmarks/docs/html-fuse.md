# `@lit-core/html-fuse` empirical benchmark results

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
| `lit` | Core runtime | `3.3.3` | n/a |
| `vite` | Bundler | `8.3.1` | n/a |
| `playwright` | Runtime evaluation engine | `1.63.0` | n/a |
| `node` | Runtime environment | `v24.14.0` | n/a |

---

## Bundle size and runtime performance comparison

Measurements compare a standard Vite production build with minification (`minify: true`) against an identical build with only `@lit-core/html-fuse` enabled (`threshold: 2`, `minFragmentLength: 15`). Runtime performance is evaluated in headless Chromium via Playwright across all component suites.

| Metric | Carbon Web Components (99 elements) | Spectrum Web Components (52 elements) | Web Awesome (73 elements) | Momentum Design (97 elements) | Material Web (28 elements) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Baseline bundle size** | 5,801.88 KB | 1,878.33 KB | 803.12 KB | 870.05 KB | 448.37 KB |
| **Optimized bundle size** | 5,799.20 KB | 1,876.62 KB | 801.80 KB | 869.70 KB | 446.99 KB |
| **Net bundle savings** | **-2.68 KB (-0.05%)** | **-1.71 KB (-0.09%)** | **-1.33 KB (-0.17%)** | **-0.35 KB (-0.04%)** | **-1.38 KB (-0.31%)** |
| **Baseline mount latency** | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| **Optimized mount latency** | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| **Mount speedup** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** |
| **Baseline update latency** | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| **Optimized update latency** | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| **Update speedup** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** |

> [!NOTE]
> `html-fuse` is an ahead-of-time static fragment clustering and deduplication transform. It identifies repeated static HTML and SVG subtrees across components and clusters them into shared template constants. Because it does not alter the runtime Lit template compiler or bypass the template prepare phase (which is handled separately by `@lit-core/html-aot`), runtime mount and update latencies are neutral and remain within standard measurement noise.

---

## Fragment clustering diagnostics and build overhead

Detailed AST scan, static template clustering diagnostics, and compilation times:

| Design system or library | Fragments scanned | Duplicate fragments fused | Shared template constants | Components rewritten | Baseline build | `html-fuse` build | Build overhead |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Carbon Web Components | 596 | 35 | 19 | 32 | 206 ms | 254 ms | +48 ms |
| Spectrum Web Components | 874 | 160 | 120 | 108 | 196 ms | 449 ms | +253 ms |
| Web Awesome | 200 | 31 | 14 | 23 | 88 ms | 133 ms | +45 ms |
| Momentum Design | 79 | 16 | 8 | 12 | 134 ms | 161 ms | +27 ms |
| Material Web | 187 | 29 | 11 | 27 | 34 ms | 59 ms | +25 ms |

---

## Running this benchmark

```bash
# Run isolated html-fuse benchmark across all libraries
node packages/benchmarks/src/index.js --tools=html-fuse

# Run on a specific library
node packages/benchmarks/src/index.js --suite=webawesome --tools=html-fuse
```

---

## Architectural highlights and invariants

- **Cross-component fragment clustering**: Identifies identical static HTML and SVG markup subtrees and hoists them into shared virtual constants.
- **Rollup chunk scoping**: Clusters fragments strictly within chunk boundaries to prevent bundling overhead across lazy modules.
- **Dynamic expression preservation**: Only pure static HTML subtrees devoid of dynamic template bindings (`${...}`) are candidates for deduplication.
- **Strict general-purpose design**: Zero library-specific class or tag filters; clusters solely on structural frequency and configurable length thresholds.

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [`@lit-core/html-fuse` package documentation](../../html-fuse/README.md)
- [Fragment clustering guide](../../html-fuse/docs/fragment-clustering.md)
- [AOT template compilation benchmark](html-aot.md)
