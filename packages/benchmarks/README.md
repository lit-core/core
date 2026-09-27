# `@lit-core/benchmarks`

> Empirical bundle size, build time, and runtime performance benchmarks for `@lit-core` across production Lit design systems.

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

## Executive overview

### Static bundle size analysis

| Design system or library | Elements | Baseline size | Optimized size | Net savings | Baseline build | Optimized build | Build overhead |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 5,801.88 KB | 2,807.99 KB | **-2,993.88 KB (-51.60%)** | 206 ms | 1,559 ms | +1,353 ms |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,603.62 KB | **-136.30 KB (-7.83%)** | 196 ms | 1,864 ms | +1,668 ms |
| Web Awesome | 73 | 803.12 KB | 739.07 KB | **-64.05 KB (-7.98%)** | 88 ms | 656 ms | +568 ms |
| Momentum Design | 97 | 870.05 KB | 867.13 KB | **-2.92 KB (-0.34%)** | 134 ms | 742 ms | +609 ms |
| Material Web | 28 | 448.37 KB | 450.40 KB | **-2.03 KB (-0.45%)** | 34 ms | 355 ms | +322 ms |
| **Total** | **349** | **9,663.34 KB** | **6,468.22 KB** | **-3,195.12 KB (-33.06%)** | **658 ms** | **5,177 ms** | **+4,518 ms** |

---

## Per-feature impact breakdown

### 1. `css-fuse` (CSS AST deduplication)

Deduplicates identical CSS declaration blocks into shared constructable stylesheet virtual modules.

| Design system or library | Elements | Baseline size | Optimized size | Savings | Build time |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 5,801.88 KB | 2,826.64 KB | -2,975.24 KB (-51.28%) | 677 ms |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,619.78 KB | -120.14 KB (-6.90%) | 1,700 ms |
| Web Awesome | 73 | 803.12 KB | 731.78 KB | -71.34 KB (-8.88%) | 171 ms |
| Momentum Design | 97 | 870.05 KB | 845.73 KB | -24.32 KB (-2.79%) | 269 ms |
| Material Web | 28 | 448.37 KB | 452.41 KB | +4.04 KB (+0.90%) | 164 ms |
| **Total** | **349** | **9,663.34 KB** | **6,476.34 KB** | **-3,186.99 KB (-32.98%)** | **2,981 ms** |

### 2. `html-fuse` (HTML and SVG AST deduplication)

Extracts repeated static HTML and SVG subtrees into shared template constants.

| Design system or library | Elements | Baseline size | Optimized size | Savings | Build time |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,736.80 KB | -3.12 KB (-0.18%) | 449 ms |
| Carbon Web Components | 99 | 5,801.88 KB | 5,799.20 KB | -2.68 KB (-0.05%) | 254 ms |
| Material Web | 28 | 448.37 KB | 446.99 KB | -1.38 KB (-0.31%) | 59 ms |
| Web Awesome | 73 | 803.12 KB | 801.80 KB | -1.33 KB (-0.17%) | 133 ms |
| Momentum Design | 97 | 870.05 KB | 869.70 KB | -0.35 KB (-0.04%) | 161 ms |
| **Total** | **349** | **9,663.34 KB** | **9,654.48 KB** | **-8.86 KB (-0.09%)** | **1,056 ms** |

### 3. `css-minifier` (embedded CSS template minification)

Minifies embedded Lit `css` tagged template strings at the AST level using Lightning CSS.

| Design system or library | Elements | Baseline size | Optimized size | Savings | Build time |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Web Awesome | 73 | 803.12 KB | 733.47 KB | -69.65 KB (-8.67%) | 88 ms |
| Momentum Design | 97 | 870.05 KB | 833.56 KB | -36.49 KB (-4.19%) | 105 ms |
| Material Web | 28 | 448.37 KB | 441.92 KB | -6.45 KB (-1.44%) | 42 ms |
| Carbon Web Components | 99 | 5,801.88 KB | 5,801.88 KB | — | 161 ms |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,739.92 KB | — | 97 ms |
| **Total** | **349** | **9,663.34 KB** | **9,550.75 KB** | **-112.59 KB (-1.17%)** | **494 ms** |

### 4. `html-minifier` (Lit HTML and SVG template minification)

Minifies embedded Lit `html` and `svg` template literals ahead of time via OXC AST traversal.

| Design system or library | Elements | Baseline size | Optimized size | Savings | Build time |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 5,801.88 KB | 5,747.27 KB | -54.60 KB (-0.94%) | 153 ms |
| Web Awesome | 73 | 803.12 KB | 775.79 KB | -27.33 KB (-3.40%) | 73 ms |
| Momentum Design | 97 | 870.05 KB | 852.54 KB | -17.51 KB (-2.01%) | 98 ms |
| Material Web | 28 | 448.37 KB | 441.81 KB | -6.57 KB (-1.46%) | 33 ms |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,739.92 KB | — | 115 ms |
| **Total** | **349** | **9,663.34 KB** | **9,557.33 KB** | **-106.01 KB (-1.10%)** | **473 ms** |

### 5. `html-aot` (ahead-of-time Lit template compilation)

Compiles Lit templates ahead of time into pre-parsed template descriptors. Eliminates runtime HTML parsing and template preparation phases.

| Design system or library | Elements | Baseline size | Optimized size | Savings | Build time |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,740.01 KB | +0.09 KB (+0.01%) | 107 ms |
| Material Web | 28 | 448.37 KB | 464.87 KB | +16.50 KB (+3.68%) | 197 ms |
| Web Awesome | 73 | 803.12 KB | 832.30 KB | +29.17 KB (+3.63%) | 550 ms |
| Momentum Design | 97 | 870.05 KB | 909.94 KB | +39.89 KB (+4.58%) | 442 ms |
| Carbon Web Components | 99 | 5,801.88 KB | 5,895.20 KB | +93.33 KB (+1.61%) | 841 ms |
| **Total** | **349** | **9,663.34 KB** | **9,842.32 KB** | **+178.98 KB (+1.85%)** | **2,138 ms** |

### 6. `props-lower` (AOT decorator and property lowering)

Compiles Lit property and state decorators into static `properties` definitions ahead of time.

| Design system or library | Elements | Baseline size | Optimized size | Savings | Build time |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Web Awesome | 73 | 803.12 KB | 803.12 KB | — | 74 ms |
| Material Web | 28 | 448.37 KB | 448.37 KB | — | 42 ms |
| Carbon Web Components | 99 | 5,801.88 KB | 5,801.88 KB | — | 289 ms |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,739.92 KB | — | 109 ms |
| Momentum Design | 97 | 870.05 KB | 870.05 KB | — | 101 ms |
| **Total** | **349** | **9,663.34 KB** | **9,663.34 KB** | **—** | **615 ms** |

---

## Runtime performance analysis

Runtime latency measured in headless Chromium via Playwright:

| Optimization tool or mode | First render (mount) | Re-render (update) | Render speedup |
| :--- | ---: | ---: | ---: |
| Baseline (standard Vite) | 14.85 ms | 3.41 ms | — |
| `css-fuse` (CSS AST deduplication) | 9.25 ms | 2.91 ms | **+37.7%** |
| `html-fuse` (HTML and SVG AST deduplication) | 9.45 ms | 2.95 ms | **+36.4%** |
| `props-lower` (AOT decorator and property lowering) | 9.25 ms | 2.91 ms | **+37.7%** |
| `elem-proxy` (deferred custom element proxy stubs) | 9.25 ms | 2.91 ms | **+37.7%** |
| `html-aot` (ahead-of-time Lit template compilation) | 9.20 ms | 2.90 ms | **+38.0%** |
| `css-minifier` (embedded CSS template minification) | 9.30 ms | 2.92 ms | **+37.4%** |
| `html-minifier` (Lit HTML and SVG template minification) | 9.30 ms | 2.92 ms | **+37.4%** |
| **Total** (all optimizations combined) | **9.45 ms** | **2.95 ms** | **+36.4%** |

---

## Runtime initialization and deferred proxy evaluation (`elem-proxy`)

Evaluates initial script evaluation CPU time, V8 heap memory footprint, and mount latency when deferring heavy Lit class evaluation until DOM mount or property access:

### Carbon Web Components (99 components)

| Metric | Baseline (eager Lit evaluation) | Optimized (elem-proxy) | Delta / savings |
| :--- | ---: | ---: | ---: |
| Script evaluation time (ms) | 114.21 ms | 31.07 ms | -72.8% CPU time |
| V8 heap memory (KB) | 148,462.0 KB | 48,364.2 KB | -67.4% memory |
| Mount latency (first 5 components) | 1.90 ms | 2.80 ms | +0.90 ms (JIT upgrade) |
| Classes evaluated during init | 99 / 99 (100.0%) | 5 / 99 (5.1%) | -94 classes |
| Deferred execution savings | 0 / 99 (0.0%) | 94 / 99 (94.9%) | +94.9% deferred |

### Spectrum Web Components (52 components)

| Metric | Baseline (eager Lit evaluation) | Optimized (elem-proxy) | Delta / savings |
| :--- | ---: | ---: | ---: |
| Script evaluation time (ms) | 48.64 ms | 13.98 ms | -71.3% CPU time |
| V8 heap memory (KB) | 197,775.7 KB | 58,914.2 KB | -70.2% memory |
| Mount latency (first 5 components) | 1.90 ms | 2.80 ms | +0.90 ms (JIT upgrade) |
| Classes evaluated during init | 52 / 52 (100.0%) | 5 / 52 (9.6%) | -47 classes |
| Deferred execution savings | 0 / 52 (0.0%) | 47 / 52 (90.4%) | +90.4% deferred |

---

## Deduplication diagnostics

### CSS deduplication diagnostics (`css-fuse`)

| Design system or library | Rules scanned | Duplicate rules fused | Shared sheets created | Chunks rewritten |
| :--- | ---: | ---: | ---: | ---: |
| **Carbon Web Components** | 23,881 | 14,999 | 98 | 102 |
| **Spectrum Web Components** | 10,794 | 10,311 | 431 | 536 |
| **Material Web** | 1,354 | 215 | 82 | 73 |
| **Momentum Design** | 1,094 | 227 | 68 | 76 |
| **Web Awesome** | 1,001 | 212 | 83 | 68 |

### HTML template deduplication diagnostics (`html-fuse`)

| Design system or library | Fragments scanned | Duplicate fragments fused | Shared templates created | Components rewritten |
| :--- | ---: | ---: | ---: | ---: |
| **Spectrum Web Components** | 874 | 160 | 120 | 108 |
| **Carbon Web Components** | 596 | 35 | 19 | 32 |
| **Web Awesome** | 200 | 31 | 14 | 23 |
| **Material Web** | 187 | 29 | 11 | 27 |
| **Momentum Design** | 79 | 16 | 8 | 12 |

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

# Run elem-proxy runtime initialization benchmarks
pnpm run benchmark:elem-proxy

# Test isolated tools
node packages/benchmarks/src/index.js --suite=webawesome --tools=html-fuse
node packages/benchmarks/src/index.js --suite=carbon --tools=html-fuse,css-fuse

# Output formatted markdown report
pnpm run benchmark:markdown
```

---

## Deep-dive documentation

- [Benchmark methodology and test harness design](docs/methodology.md)
- [Metric definitions and calculation guide](docs/metrics.md)
- [CSS deduplication engine architecture](../css-fuse/docs/architecture.md)
- [HTML fragment clustering guide](../html-fuse/docs/fragment-clustering.md)
- [Deferred element proxy architecture](../elem-proxy/docs/proxy-architecture.md)
