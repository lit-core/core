# `@lit-core/benchmarks`

> Bundle size and deduplication benchmarks for `@lit-core` optimization tools across production Lit design systems.

Benchmarks evaluate standard Vite production builds (**Baseline**) against optimized builds across **349 production Web Components** from 5 major design systems:
- **Carbon Web Components** (`@carbon/web-components`, 99 elements)
- **Momentum Design** (`@momentum-design/components`, 97 elements)
- **Web Awesome** (`@awesome.me/webawesome`, 73 elements)
- **Spectrum Web Components** (`@spectrum-web-components`, 52 elements)
- **Material Web** (`@material/web`, 28 elements)

---

## 📊 Results summary

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

# Test isolated tools
node packages/benchmarks/src/index.js --suite=webawesome --tools=html-fuse
node packages/benchmarks/src/index.js --suite=carbon --tools=html-fuse,css-fuse

# Output markdown format
pnpm run benchmark:markdown
```
