# `@lit-core/benchmarks`

> Empirical bundle size, build overhead, and runtime performance benchmarks for `@lit-core` across production Lit design systems.

The `@lit-core/benchmarks` package evaluates standard Vite production builds (**Baseline**) against optimized builds across **349 production Web Components** from 5 major enterprise design systems:
- **Carbon Web Components** (`@carbon/web-components`, 99 elements)
- **Momentum Design** (`@momentum-design/components`, 97 elements)
- **Web Awesome** (`@awesome.me/webawesome`, 73 elements)
- **Spectrum Web Components** (`@spectrum-web-components/bundle`, 52 elements)
- **Material Web** (`@material/web`, 28 elements)

---

## Benchmarked dependency versions

| Package | Role | Evaluated version | Elements evaluated |
| :--- | :--- | :--- | ---: |
| `@carbon/web-components` | Design system component suite | `2.64.0` | 99 elements |
| `@momentum-design/components` | Design system component suite | `0.139.9` | 97 elements |
| `@awesome.me/webawesome` | Design system component suite | `3.14.0` | 73 elements |
| `@spectrum-web-components/bundle` | Design system component suite | `1.12.2` | 52 elements |
| `@material/web` | Design system component suite | `2.5.0` | 28 elements |
| `lit` | Core runtime & toolchain | `3.3.3` | — |
| `vite` | Core runtime & toolchain | `8.3.1` | — |
| `playwright` | Core runtime & toolchain | `1.63.0` | — |
| `node` | Core runtime & toolchain | `v24.14.0` | — |

---

## Executive overview (all optimizations combined)

| Metric | Carbon Web Components (99 elements) | Spectrum Web Components (52 elements) | Web Awesome (73 elements) | Momentum Design (97 elements) | Material Web (28 elements) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Baseline bundle size** | 5,801.88 KB | 1,739.92 KB | 803.12 KB | 870.05 KB | 448.37 KB |
| **Optimized bundle size** | 2,807.99 KB | 1,603.62 KB | 739.07 KB | 867.13 KB | 450.40 KB |
| **Net bundle savings** | **-2,993.88 KB (-51.60%)** | **-136.30 KB (-7.83%)** | **-64.05 KB (-7.98%)** | **-2.92 KB (-0.34%)** | **-2.03 KB (-0.45%)** |
| **Baseline build time** | 206 ms | 196 ms | 88 ms | 134 ms | 34 ms |
| **Optimized build time** | 1,559 ms | 1,864 ms | 656 ms | 742 ms | 355 ms |
| **Build overhead** | +1,353 ms | +1,668 ms | +568 ms | +609 ms | +322 ms |
| **First render speedup** | **+37.7% faster** | **+37.7% faster** | **+36.8% faster** | **+37.4% faster** | **+37.2% faster** |

---

## Dedicated per-feature benchmarks

Detailed benchmarks, full AST diagnostics, build durations, and runtime measurements are documented individually per feature:

- [**`css-fuse` benchmark**](docs/css-fuse.md): Full CSS AST deduplication, constructable stylesheet metrics, and up to -51.3% size reduction.
- [**`html-fuse` benchmark**](docs/html-fuse.md): Static HTML and SVG fragment clustering and consolidated innerHTML parsing.
- [**`elem-proxy` benchmark**](docs/elem-proxy.md): Deferred element proxy stubs, -72.8% script evaluation CPU time, and -67.4% to -70.2% V8 heap memory savings.
- [**`html-aot` benchmark**](docs/html-aot.md): Ahead-of-time Lit template compilation, eliminated runtime prepare overhead, and +38.0% render speedup.
- [**`props-lower` benchmark**](docs/props-lower.md): Native Rust decorator lowering, zero runtime reflection, and up to -6.1% size reduction.
- [**Template minifiers benchmark**](docs/template-minifiers.md): High-speed Lightning CSS and OXC template minification (`css-minifier` & `html-minifier`).

---

## Running benchmarks

```bash
# Run all benchmark suites
pnpm run benchmark

# Run a specific suite
pnpm run benchmark:webawesome
pnpm run benchmark:momentum
node packages/benchmarks/src/index.js --suite=carbon
node packages/benchmarks/src/index.js --suite=spectrum
node packages/benchmarks/src/index.js --suite=material

# Run isolated tools
node packages/benchmarks/src/index.js --tools=css-fuse
node packages/benchmarks/src/index.js --tools=html-fuse
node packages/benchmarks/src/index.js --tools=props-lower
node packages/benchmarks/src/index.js --tools=html-aot
node packages/benchmarks/src/index.js --tools=css-minifier
node packages/benchmarks/src/index.js --tools=html-minifier

# Run elem-proxy runtime initialization benchmarks
pnpm run benchmark:elem-proxy

# Output formatted markdown report
pnpm run benchmark:markdown
```
