# `@lit-core/benchmarks`

> Bundle size and deduplication benchmarks for `@lit-core` optimization tools across production Lit design systems.

Benchmarks evaluate standard Vite production builds (**Baseline**) against optimized builds across **349 production Web Components** from 5 major design systems:
- **Carbon Web Components** (`@carbon/web-components`, 99 elements)
- **Momentum Design** (`@momentum-design/components`, 97 elements)
- **Web Awesome** (`@awesome.me/webawesome`, 73 elements)
- **Spectrum Web Components** (`@spectrum-web-components`, 52 elements)
- **Material Web** (`@material/web`, 28 elements)

---

### 📦 Static bundle size analysis

| Design system or library | Elements | Baseline size | Optimized size | Net savings |
| :--- | ---: | ---: | ---: | ---: |
| **Carbon Web Components** | 99 | 5,801.88 KB | 2,652.04 KB | **-3,149.83 KB (-54.29%)** |
| **Spectrum Web Components** | 52 | 1,739.92 KB | 1,478.34 KB | **-261.58 KB (-15.03%)** |
| **Web Awesome** | 73 | 803.12 KB | 681.46 KB | **-121.66 KB (-15.15%)** |
| **Momentum Design** | 97 | 870.05 KB | 812.17 KB | **-57.88 KB (-6.65%)** |
| **Material Web** | 28 | 448.37 KB | 425.51 KB | **-22.86 KB (-5.10%)** |
| **Total** | **349** | **9,663.34 KB** | **6,049.52 KB** | **-3,613.82 KB (-37.40%)** |

---

## 🛠️ Per-tool impact breakdown

### `css-fuse` (CSS AST deduplication)

| Design system or library | Elements | Baseline size | Optimized size | Savings |
| :--- | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 5,801.88 KB | 2,826.79 KB | -2,975.09 KB (-51.28%) |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,621.17 KB | -118.75 KB (-6.82%) |
| Web Awesome | 73 | 803.12 KB | 739.72 KB | -63.40 KB (-7.89%) |
| Momentum Design | 97 | 870.05 KB | 850.00 KB | -20.04 KB (-2.30%) |
| Material Web | 28 | 448.37 KB | 450.92 KB | +2.55 KB (+0.57%) |
| Total | 349 | 9,663.34 KB | 6,488.60 KB | -3,174.73 KB (-32.85%) |

### `html-fuse` (HTML and SVG AST deduplication)

| Design system or library | Elements | Baseline size | Optimized size | Savings |
| :--- | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 5,801.88 KB | 5,799.25 KB | -2.63 KB (-0.05%) |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,737.40 KB | -2.52 KB (-0.14%) |
| Web Awesome | 73 | 803.12 KB | 801.98 KB | -1.15 KB (-0.14%) |
| Material Web | 28 | 448.37 KB | 447.41 KB | -0.96 KB (-0.21%) |
| Momentum Design | 97 | 870.05 KB | 869.70 KB | -0.35 KB (-0.04%) |
| Total | 349 | 9,663.34 KB | 9,655.73 KB | -7.60 KB (-0.08%) |

### `props-lower` (AOT decorator and property lowering)

| Design system or library | Elements | Baseline size | Optimized size | Savings |
| :--- | ---: | ---: | ---: | ---: |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,633.12 KB | -106.80 KB (-6.14%) |
| Carbon Web Components | 99 | 5,801.88 KB | 5,793.47 KB | -8.41 KB (-0.14%) |
| Material Web | 28 | 448.37 KB | 445.74 KB | -2.63 KB (-0.59%) |
| Web Awesome | 73 | 803.12 KB | 800.61 KB | -2.51 KB (-0.31%) |
| Momentum Design | 97 | 870.05 KB | 871.99 KB | +1.94 KB (+0.22%) |
| Total | 349 | 9,663.34 KB | 9,544.93 KB | -118.40 KB (-1.23%) |

### `css-minifier` (embedded CSS minification)

| Design system or library | Elements | Baseline size | Optimized size | Savings |
| :--- | ---: | ---: | ---: | ---: |
| Web Awesome | 73 | 803.12 KB | 733.47 KB | -69.65 KB (-8.67%) |
| Carbon Web Components | 99 | 5,801.88 KB | 5,759.60 KB | -42.27 KB (-0.73%) |
| Momentum Design | 97 | 870.05 KB | 833.56 KB | -36.49 KB (-4.19%) |
| Material Web | 28 | 448.37 KB | 441.92 KB | -6.45 KB (-1.44%) |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,739.09 KB | -0.83 KB (-0.05%) |
| Total | 349 | 9,663.34 KB | 9,507.65 KB | -155.69 KB (-1.61%) |

### `html-minifier` (Lit HTML and SVG template minification)

| Design system or library | Elements | Baseline size | Optimized size | Savings |
| :--- | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 5,801.88 KB | 5,747.27 KB | -54.60 KB (-0.94%) |
| Web Awesome | 73 | 803.12 KB | 775.79 KB | -27.33 KB (-3.40%) |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,718.86 KB | -21.06 KB (-1.21%) |
| Momentum Design | 97 | 870.05 KB | 852.54 KB | -17.51 KB (-2.01%) |
| Material Web | 28 | 448.37 KB | 441.81 KB | -6.57 KB (-1.46%) |
| Total | 349 | 9,663.34 KB | 9,536.26 KB | -127.07 KB (-1.32%) |

### `html-aot` (Ahead-of-time Lit template compilation)

| Design system or library | Elements | Baseline size | Optimized size | Savings |
| :--- | ---: | ---: | ---: | ---: |
| Web Awesome | 73 | 803.12 KB | 832.30 KB | +29.17 KB (+3.63%) |
| Carbon Web Components | 99 | 5,801.88 KB | 5,918.42 KB | +116.54 KB (+2.01%) |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,788.64 KB | +48.72 KB (+2.80%) |
| Momentum Design | 97 | 870.05 KB | 891.80 KB | +21.75 KB (+2.50%) |
| Material Web | 28 | 448.37 KB | 458.23 KB | +9.86 KB (+2.20%) |
| Total | 349 | 9,663.34 KB | 9,889.39 KB | +226.04 KB (+2.34%) |

---

### ⏱️ Runtime performance

Runtime benchmarks measure initial first render (mount) latency, re-render (update) latency, and render speedup across component trees in Chromium via Playwright:

| Optimization tool or mode | First render (mount) | Re-render (update) | Render speedup |
| :--- | ---: | ---: | ---: |
| *Baseline* Baseline (Standard Vite) | 14.80 ms | 3.40 ms | — |
| `css-fuse` (CSS AST deduplication) | 9.60 ms | 2.98 ms | **+35.1%** |
| `html-fuse` (HTML and SVG AST deduplication) | 9.35 ms | 2.93 ms | **+36.8%** |
| `props-lower` (AOT decorator and property lowering) | 9.20 ms | 2.90 ms | **+37.8%** |
| `html-aot` (Ahead-of-time Lit template compilation) | 9.45 ms | 2.95 ms | **+36.1%** |
| `css-minifier` (Embedded CSS template minification) | 9.40 ms | 2.94 ms | **+36.5%** |
| `html-minifier` (Lit HTML and SVG template minification) | 9.25 ms | 2.91 ms | **+37.5%** |
| **Total** (All optimizations combined) | 9.35 ms | 2.93 ms | **+36.8%** |

### ⚡ Runtime initialization and proxy evaluation (`elem-proxy`)

Benchmarks evaluate script evaluation CPU time, V8 heap memory, and mount latency when deferring heavy Lit class evaluation until DOM mount or property access:

#### Carbon Web Components (99 components)

| Metric | Baseline (eager Lit evaluation) | Optimized (elem-proxy) | Delta / savings |
| :--- | ---: | ---: | ---: |
| Script evaluation time (ms) | 113.94 ms | 31.13 ms | -72.7% CPU time |
| V8 heap memory (KB) | 12968.1 KB | 3059.9 KB | -76.4% memory |
| Mount latency (first 5 components) | 1.90 ms | 2.81 ms | +0.91 ms (JIT upgrade) |
| Classes evaluated during init | 99 / 99 (100.0%) | 5 / 99 (5.1%) | -94 classes |
| Deferred execution savings | 0 / 99 (0.0%) | 94 / 99 (94.9%) | +94.9% deferred |

#### Spectrum Web Components (52 components)

| Metric | Baseline (eager Lit evaluation) | Optimized (elem-proxy) | Delta / savings |
| :--- | ---: | ---: | ---: |
| Script evaluation time (ms) | 48.78 ms | 13.99 ms | -71.3% CPU time |
| V8 heap memory (KB) | 4584.9 KB | 1072.8 KB | -76.6% memory |
| Mount latency (first 5 components) | 1.90 ms | 2.80 ms | +0.90 ms (JIT upgrade) |
| Classes evaluated during init | 52 / 52 (100.0%) | 5 / 52 (9.6%) | -47 classes |
| Deferred execution savings | 0 / 52 (0.0%) | 47 / 52 (90.4%) | +90.4% deferred |

---

## 🏃 Running benchmarks

```bash
# Run all benchmark suites
pnpm run benchmark

# Run a specific suite
pnpm run benchmark:webawesome
pnpm run benchmark:momentum
node packages/benchmarks/src/index.js --suite=carbon
node packages/benchmarks/src/index.js --suite=spectrum
node packages/benchmarks/src/index.js --suite=material
node packages/benchmarks/src/index.js --suite=momentum

# Run elem-proxy runtime initialization benchmarks
pnpm run benchmark:elem-proxy

# Test isolated tools
node packages/benchmarks/src/index.js --suite=webawesome --tools=html-fuse
node packages/benchmarks/src/index.js --suite=carbon --tools=html-fuse,css-fuse

# Output markdown format
pnpm run benchmark:markdown
```
