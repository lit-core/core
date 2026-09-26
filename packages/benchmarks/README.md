# `@lit-core/benchmarks`

> Bundle size and deduplication benchmarks for `@lit-core` optimization tools across production Lit design systems.

Benchmarks evaluate standard Vite production builds (**Baseline**) against optimized builds with `@lit-core` tools (`cssFuse` AST deduplication, `propsLower` decorator lowering, and `cssMinifier` embedded CSS minification) across **252 production Web Components** from 4 major design systems:
- **Carbon Web Components** (`@carbon/web-components`, 99 elements)
- **Spectrum Web Components** (`@spectrum-web-components`, 52 elements)
- **Web Awesome** (`@awesome.me/webawesome`, 73 elements)
- **Material Web** (`@material/web`, 28 elements)

---

## 📊 Results summary

| Design system or library | Elements | Baseline (min / gzip) | Optimized (min / gzip) | Net savings (raw) | Net savings (gzip) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Carbon Web Components** | 99 | 5,801.88 KB / 708.93 KB | 2,622.66 KB / 409.93 KB | **-3,179.22 KB (-54.80%)** | **-299.00 KB (-42.18%)** |
| **Spectrum Web Components** | 52 | 1,739.92 KB / 269.95 KB | 1,603.12 KB / 258.72 KB | **-136.80 KB (-7.86%)** | **-11.23 KB (-4.16%)** |
| **Web Awesome** | 73 | 803.12 KB / 190.44 KB | 684.50 KB / 169.19 KB | **-118.63 KB (-14.77%)** | **-21.25 KB (-11.16%)** |
| **Material Web** | 28 | 448.37 KB / 76.63 KB | 428.77 KB / 75.33 KB | **-19.60 KB (-4.37%)** | **-1.30 KB (-1.69%)** |
| **Total** | **252** | **8,793.29 KB / 1,245.95 KB** | **5,339.04 KB / 913.17 KB** | **-3,454.24 KB (-39.28%)** | **-332.78 KB (-26.71%)** |

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
