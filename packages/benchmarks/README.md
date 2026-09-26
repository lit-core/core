# `@lit-core/benchmarks`

> Bundle size and deduplication benchmarks for `@lit-core` optimization tools across production Lit design systems.

Benchmarks evaluate standard Vite production builds (**Baseline**) against optimized builds across **252 production Web Components** from 4 major design systems:
- **Carbon Web Components** (`@carbon/web-components`, 99 elements)
- **Spectrum Web Components** (`@spectrum-web-components`, 52 elements)
- **Web Awesome** (`@awesome.me/webawesome`, 73 elements)
- **Material Web** (`@material/web`, 28 elements)

---

## 📊 Results summary

| Design system or library | Elements | Baseline size | Optimized size | Net savings |
| :--- | ---: | ---: | ---: | ---: |
| **Carbon Web Components** | 99 | 5,801.88 KB | 2,622.61 KB | **-3,179.26 KB (-54.80%)** |
| **Spectrum Web Components** | 52 | 1,739.92 KB | 1,581.30 KB | **-158.62 KB (-9.12%)** |
| **Web Awesome** | 73 | 803.12 KB | 682.78 KB | **-120.34 KB (-14.98%)** |
| **Material Web** | 28 | 448.37 KB | 428.48 KB | **-19.89 KB (-4.44%)** |
| **Total** | **252** | **8,793.29 KB** | **5,315.17 KB** | **-3,478.12 KB (-39.55%)** |

---

<details>
<summary><strong>Per-tool impact breakdown</strong> — Click to expand individual tool tables</summary>

### `css-fuse` (CSS AST deduplication)

| Design system or library | Elements | Baseline size | Optimized size | Savings |
| :--- | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 5,801.88 KB | 2,761.86 KB | -3,040.02 KB (-52.40%) |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,619.78 KB | -120.14 KB (-6.90%) |
| Web Awesome | 73 | 803.12 KB | 731.78 KB | -71.34 KB (-8.88%) |
| Material Web | 28 | 448.37 KB | 444.31 KB | -4.06 KB (-0.91%) |
| Total | 252 | 8,793.29 KB | 5,557.72 KB | -3,235.56 KB (-36.80%) |

### `css-minifier` (embedded CSS minification)

| Design system or library | Elements | Baseline size | Optimized size | Savings |
| :--- | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 5,801.88 KB | 5,759.60 KB | -42.27 KB (-0.73%) |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,739.09 KB | -0.83 KB (-0.05%) |
| Web Awesome | 73 | 803.12 KB | 733.47 KB | -69.65 KB (-8.67%) |
| Material Web | 28 | 448.37 KB | 441.92 KB | -6.45 KB (-1.44%) |
| Total | 252 | 8,793.29 KB | 8,674.09 KB | -119.19 KB (-1.36%) |

### `html-minifier` (Lit HTML and SVG template minification)

| Design system or library | Elements | Baseline size | Optimized size | Savings |
| :--- | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 5,801.88 KB | 5,747.27 KB | -54.60 KB (-0.94%) |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,718.86 KB | -21.06 KB (-1.21%) |
| Web Awesome | 73 | 803.12 KB | 775.79 KB | -27.33 KB (-3.40%) |
| Material Web | 28 | 448.37 KB | 441.81 KB | -6.57 KB (-1.46%) |
| Total | 252 | 8,793.29 KB | 8,683.72 KB | -109.57 KB (-1.25%) |

### `props-lower` (AOT decorator lowering)

| Design system or library | Elements | Baseline size | Optimized size | Savings |
| :--- | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 5,801.88 KB | 5,801.88 KB | — |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,739.92 KB | — |
| Web Awesome | 73 | 803.12 KB | 803.12 KB | — |
| Material Web | 28 | 448.37 KB | 448.37 KB | — |
| Total | 252 | 8,793.29 KB | 8,793.29 KB | — |

</details>

---

## 🔬 Deduplication diagnostics

| Design system or library | Rules scanned | Duplicate rules fused | Shared sheets created | Chunks rewritten |
| :--- | ---: | ---: | ---: | ---: |
| **Carbon Web Components** | 135,434 | 129,973 | 211 | 117 |
| **Spectrum Web Components** | 14,046 | 14,242 | 431 | 536 |
| **Web Awesome** | 1,001 | 212 | 83 | 68 |
| **Material Web** | 2,466 | 1,505 | 155 | 98 |

---

## 🏃 Running benchmarks

```bash
# Run all benchmark suites
pnpm run benchmark

# Run a specific suite
pnpm run benchmark:webawesome
node packages/benchmarks/src/index.js --suite=carbon
node packages/benchmarks/src/index.js --suite=spectrum
node packages/benchmarks/src/index.js --suite=material

# Output markdown format
pnpm run benchmark:markdown
```
