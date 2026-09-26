# `@lit-core/benchmarks` (Private)

> Comprehensive multi-tool and multi-suite bundle size benchmark harness for the `@lit-core` Vite bundler ecosystem.

This document records the empirical bundle-size metrics, deduplication statistics, isolated tool impacts, and combined totals across different component suites and Vite bundler optimization tools.

---

## 🎯 Purpose & Design

As new optimization options and tools are added to the `@lit-core` Vite bundler (such as `cssFuse` AST deduplication and `propsLower` decorator/property lowering), this benchmark package measures:
1. **Isolated Tool Impact**: The marginal bundle size reduction contributed by each individual tool / option.
2. **Total Bundle Impact**: The cumulative bundle size reduction when all active tools and optimizations are applied together.
3. **Multi-Suite Coverage**: Verifying savings not just against Web Awesome, but across component subsets (Forms, Overlays), Lit components authored with TypeScript decorators, and arbitrary custom suites.
4. **Markdown & CI Reporting**: Generating structured comparison tables directly into markdown documentation.

---

## 📊 Bundle Size Impact Matrix

### 1. Web Awesome (Full Suite: 73 Components)
Production build of the complete Web Awesome suite (`@awesome.me/webawesome`).

| Optimization Tool / Mode | Minified JS | Gzip Size | Brotli Size | Raw Impact (Δ) | Gzip Impact (Δ) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| *Baseline* (Standard Vite build) | 803.12 KB | 190.44 KB | 143.00 KB | — | — |
| `cssFuse` (CSS AST Constructable Sheet Deduplication) | 731.13 KB | 176.23 KB | 134.56 KB | **-71.99 KB (-8.96%)** | **-14.20 KB (-7.46%)** |
| `propsLower` (Lit Decorators & Props Lowering) | 803.12 KB | 190.44 KB | 143.00 KB | — | — |
| **TOTAL (All Optimizations Combined)** | **731.13 KB** | **176.23 KB** | **134.56 KB** | **-71.99 KB (-8.96%)** | **-14.20 KB (-7.46%)** |

#### AST & Deduplication Statistics
- **Total CSS Rules Scanned**: 1,001 rules
- **Duplicate Rules Deduplicated**: 212 rules
- **Shared Constructable Stylesheets Created**: 83 shared modules
- **Component Chunks Rewritten**: 68 components

---

### 2. Web Awesome: Forms & Inputs Suite (15 Components)
Includes standard form controls: `button`, `button-group`, `checkbox`, `checkbox-group`, `color-picker`, `input`, `number-input`, `otp-input`, `radio`, `radio-group`, `select`, `slider`, `switch`, `tag-input`, `textarea`.

| Optimization Tool / Mode | Minified JS | Gzip Size | Brotli Size | Raw Impact (Δ) | Gzip Impact (Δ) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| *Baseline* (Standard Vite build) | 391.12 KB | 94.35 KB | 73.23 KB | — | — |
| `cssFuse` (CSS AST Deduplication) | 352.71 KB | 86.77 KB | 68.61 KB | **-38.40 KB (-9.82%)** | **-7.58 KB (-8.03%)** |
| `propsLower` (Lit Decorators & Props Lowering) | 391.12 KB | 94.35 KB | 73.23 KB | — | — |
| **TOTAL (All Optimizations Combined)** | **352.71 KB** | **86.77 KB** | **68.61 KB** | **-38.40 KB (-9.82%)** | **-7.58 KB (-8.03%)** |

---

### 3. Web Awesome: Overlays & Feedback Suite (11 Components)
Includes modal and floating UI elements: `alert`, `badge`, `callout`, `dialog`, `drawer`, `dropdown`, `dropdown-item`, `popover`, `popup`, `toast`, `tooltip`.

| Optimization Tool / Mode | Minified JS | Gzip Size | Brotli Size | Raw Impact (Δ) | Gzip Impact (Δ) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| *Baseline* (Standard Vite build) | 244.94 KB | 61.56 KB | 49.69 KB | — | — |
| `cssFuse` (CSS AST Deduplication) | 217.70 KB | 56.74 KB | 46.76 KB | **-27.23 KB (-11.12%)** | **-4.81 KB (-7.82%)** |
| `propsLower` (Lit Decorators & Props Lowering) | 244.94 KB | 61.56 KB | 49.69 KB | — | — |
| **TOTAL (All Optimizations Combined)** | **217.70 KB** | **56.74 KB** | **46.76 KB** | **-27.23 KB (-11.12%)** | **-4.81 KB (-7.82%)** |

---

### 4. Lit Elements with TypeScript Decorators (10 Elements)
Demonstrates the combined effect on modern Lit 3 components authored with `@customElement`, `@property`, `@state`, `@query`, and `@eventOptions`.

| Optimization Tool / Mode | Minified JS | Gzip Size | Brotli Size | Raw Impact (Δ) | Gzip Impact (Δ) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| *Baseline* (Standard Vite build) | 24.69 KB | 6.63 KB | 5.90 KB | — | — |
| `cssFuse` (CSS AST Deduplication) | 19.97 KB | 6.55 KB | 5.85 KB | **-4.72 KB (-19.12%)** | **-0.08 KB (-1.13%)** |
| `propsLower` (Lit Decorators & Props Lowering) | 25.26 KB | 6.32 KB | 5.59 KB | +0.57 KB (+2.32%) | **-0.31 KB (-4.64%)** |
| **TOTAL (All Optimizations Combined)** | **20.54 KB** | **6.24 KB** | **5.57 KB** | **-4.15 KB (-16.80%)** | **-0.39 KB (-5.85%)** |

---

### 5. Cross-Suite Impact Overview

| Suite | Component Count | Baseline (Raw / Gzip) | Optimized (Raw / Gzip) | Net Savings (Raw / Gzip) |
| :--- | :--- | :--- | :--- | :--- |
| **Web Awesome (Full Suite)** | 73 elements | 803.12 KB / 190.44 KB | 731.13 KB / 176.23 KB | **-71.99 KB (-8.96%)** [Gzip: -7.46%] |
| **Web Awesome: Forms & Inputs** | 15 elements | 391.12 KB / 94.35 KB | 352.71 KB / 86.77 KB | **-38.40 KB (-9.82%)** [Gzip: -8.03%] |
| **Web Awesome: Overlays & Feedback** | 11 elements | 244.94 KB / 61.56 KB | 217.70 KB / 56.74 KB | **-27.23 KB (-11.12%)** [Gzip: -7.82%] |
| **Lit Elements with Decorators** | 10 elements | 24.69 KB / 6.63 KB | 20.54 KB / 6.24 KB | **-4.15 KB (-16.80%)** [Gzip: -5.85%] |
| **Cumulative Total** | **109 elements** | **1,463.86 KB / 352.97 KB** | **1,322.08 KB / 325.99 KB** | **-141.78 KB (-9.69%)** [Gzip: -7.64%] |

---

## ⚙️ Vite Configuration

Enable `propsLower` and `cssFuse` directly in `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import lit, { cssFuse, propsLower } from '@lit-core/vite-plugin';

export default defineConfig({
  plugins: [
    lit({
      // Cross-component CSS AST deduplication into constructable stylesheets
      cssFuse: true, // or CssFuseOptions object

      // Native Rust AOT Lit decorator & property lowering
      propsLower: true, // or 'props-lower': true
    }),
  ],
});
```

Individual plugins can also be imported directly:

```typescript
import { cssFuse, propsLower } from '@lit-core/vite-plugin';

export default defineConfig({
  plugins: [
    cssFuse({ threshold: 2 }),
    propsLower({ sourcemap: true }),
  ],
});
```

---

## 🏃 Running the Benchmarks

All benchmark commands are accessible via npm scripts:

```bash
# Run all benchmark suites across all tools with terminal tables
pnpm run benchmark

# Run the Web Awesome benchmark
pnpm run benchmark:webawesome

# Output benchmark results as Markdown tables
pnpm run benchmark:markdown

# Run specific suite or tools from packages/benchmarks
cd packages/benchmarks
node src/index.js --suite=webawesome
node src/index.js --suite=lit-decorators
node src/index.js --tools=css-fuse,props-lower
node src/index.js --format=markdown
node src/index.js --format=json

# Run standalone legacy benchmark script directly
node webawesome-benchmark.js
```

### Testing Arbitrary Custom Suites

You can benchmark any external Lit component library or application entrypoint without changing source code:

```bash
node src/index.js --entry=/path/to/app/main.js --include="/path/to/app/components/**/*.js"
```

---

## 🛠️ Adding New Vite Bundler Options / Tools

The benchmark harness is architected for continuous addition of new Vite bundler optimization tools.

To add a new tool or option:

1. Create a tool definition in `src/tools/my-new-tool.js`:
   ```javascript
   export const myNewTool = {
     id: 'my-new-tool',
     name: 'myNewTool (Property & Decorator Inlining)',
     description: 'Eliminates reactive property runtime overhead',
     enabled: true,

     // Return the Vite plugin(s) configured for this tool
     getPlugins(suiteContext) {
       return [myPlugin({ option: true })];
     },

     // Optional: extract AST or optimization diagnostics
     async getDiagnostics(suiteContext) {
       return { itemsOptimized: 42 };
     },
   };
   ```

2. Register the tool in `src/tools/index.js`:
   ```javascript
   import { cssFuseTool } from './css-fuse.js';
   import { propsLowerTool } from './props-lower.js';
   import { myNewTool } from './my-new-tool.js';

   export const registeredTools = [
     cssFuseTool,
     propsLowerTool,
     myNewTool,
   ];
   ```

3. Run the benchmark:
   ```bash
   node src/index.js
   ```

The output table will automatically benchmark:
- Baseline
- `cssFuse` in isolation
- `propsLower` in isolation
- `myNewTool` in isolation
- `TOTAL` (all tools combined)
showing the exact marginal and cumulative KB / % impact!
