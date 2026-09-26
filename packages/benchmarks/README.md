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
| **Carbon Web Components** | 99 | 5,801.88 KB | 2,654.33 KB | **-3,147.55 KB (-54.25%)** |
| **Spectrum Web Components** | 52 | 1,739.92 KB | 1,478.16 KB | **-261.76 KB (-15.04%)** |
| **Web Awesome** | 73 | 803.12 KB | 682.42 KB | **-120.70 KB (-15.03%)** |
| **Momentum Design** | 97 | 870.05 KB | 812.52 KB | **-57.53 KB (-6.61%)** |
| **Material Web** | 28 | 448.37 KB | 426.26 KB | **-22.11 KB (-4.93%)** |
| **Total** | **349** | **9,663.34 KB** | **6,053.68 KB** | **-3,609.65 KB (-37.35%)** |

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

## 🔬 Deduplication diagnostics

| Design system or library | Rules scanned | Duplicate rules fused | Shared sheets created | Chunks rewritten |
| :--- | ---: | ---: | ---: | ---: |
| **Carbon Web Components** | 23,881 | 14,987 | 89 | 98 |
| **Spectrum Web Components** | 10,794 | 10,213 | 392 | 536 |
| **Material Web** | 1,354 | 138 | 32 | 63 |
| **Momentum Design** | 1,094 | 130 | 20 | 59 |
| **Web Awesome** | 1,001 | 117 | 22 | 55 |

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

# Output markdown format
pnpm run benchmark:markdown
```
