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
| **Carbon Web Components** | 99 | 5,801.88 KB | 2,622.66 KB | **-3,179.22 KB (-54.80%)** |
| **Spectrum Web Components** | 52 | 1,739.92 KB | 1,603.12 KB | **-136.80 KB (-7.86%)** |
| **Web Awesome** | 73 | 803.12 KB | 684.50 KB | **-118.63 KB (-14.77%)** |
| **Material Web** | 28 | 448.37 KB | 428.77 KB | **-19.60 KB (-4.37%)** |
| **Total** | **252** | **8,793.29 KB** | **5,339.04 KB** | **-3,454.24 KB (-39.28%)** |

---

<details>
<summary><strong>Per-tool impact breakdown</strong> — Click to expand individual tool tables</summary>

### `css-fuse` (CSS AST deduplication)

| Design system or library | Elements | Baseline size | Optimized size | Savings |
| :--- | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 5,801.88 KB | 2,761.95 KB | -3,039.92 KB (-52.40%) |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,620.41 KB | -119.51 KB (-6.87%) |
| Web Awesome | 73 | 803.12 KB | 739.19 KB | -63.93 KB (-7.96%) |
| Material Web | 28 | 448.37 KB | 444.88 KB | -3.49 KB (-0.78%) |
| Total | 252 | 8,793.29 KB | 5,566.43 KB | -3,226.85 KB (-36.70%) |

### `css-minifier` (embedded CSS minification)

| Design system or library | Elements | Baseline size | Optimized size | Savings |
| :--- | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 5,801.88 KB | 5,662.58 KB | -139.30 KB (-2.40%) |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,722.63 KB | -17.29 KB (-0.99%) |
| Web Awesome | 73 | 803.12 KB | 748.42 KB | -54.70 KB (-6.81%) |
| Material Web | 28 | 448.37 KB | 432.26 KB | -16.11 KB (-3.59%) |
| Total | 252 | 8,793.29 KB | 8,565.89 KB | -227.40 KB (-2.59%) |

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
| **Carbon Web Components** | 135,434 | 129,961 | 205 | 115 |
| **Spectrum Web Components** | 14,046 | 14,195 | 412 | 536 |
| **Web Awesome** | 1,001 | 130 | 28 | 55 |
| **Material Web** | 2,466 | 1,449 | 137 | 97 |

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
