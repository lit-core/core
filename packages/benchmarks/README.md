# `@lit-core/benchmarks` (Private)

> Comprehensive multi-library bundle size benchmark harness for the `@lit-core` Vite bundler ecosystem.

This document records the empirical bundle-size metrics, deduplication statistics, isolated tool impacts, and combined totals across major Web Component / Lit design systems and `@lit-core` Vite bundler optimization tools.

---

## 🎯 Evaluated Design Systems & Libraries

We benchmark the `@lit-core` Vite bundler plugins against **252 production Web Components** across 4 major Lit-based design systems:

1. **Carbon Web Components** (`@carbon/web-components`): IBM Carbon Design System built on Lit (99 custom elements).
2. **Spectrum Web Components** (`@spectrum-web-components`): Adobe Spectrum Design System built on Lit (52 custom elements).
3. **Web Awesome** (`@awesome.me/webawesome`): 73 production custom elements with shared styling chunks.
4. **Material Web** (`@material/web`): Google Material Design 3 Web Components built on Lit (28 component packages).

---

## 🏆 Overview: All Libraries (All Optimizations Enabled)

Comparison between standard Vite production build (Baseline) and fully optimized build with all `@lit-core` optimizations enabled (`cssFuse` + `propsLower`):

| Design System / Library | Elements | Baseline (Min / Gzip) | Optimized (All Configs) | Raw Savings (Δ) | Gzip Savings (Δ) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Carbon Web Components** (`@carbon/web-components`) | 99 | 5,801.88 KB / 708.93 KB | 2,761.95 KB / 419.47 KB | **-3,039.92 KB (-52.40%)** | **-289.46 KB (-40.83%)** |
| **Spectrum Web Components** (`@spectrum-web-components`) | 52 | 1,739.92 KB / 269.95 KB | 1,620.41 KB / 259.86 KB | **-119.51 KB (-6.87%)** | **-10.08 KB (-3.74%)** |
| **Web Awesome** (`@awesome.me/webawesome`) | 73 | 803.12 KB / 190.44 KB | 739.19 KB / 177.74 KB | **-63.93 KB (-7.96%)** | **-12.69 KB (-6.67%)** |
| **Material Web** (`@material/web`) | 28 | 448.37 KB / 76.63 KB | 444.88 KB / 76.90 KB | **-3.49 KB (-0.78%)** | -0.27 KB (-0.35%) |
| **OVERALL TOTAL (All 4 Libraries)** | **252** | **8,793.29 KB / 1,245.95 KB** | **5,566.43 KB / 933.97 KB** | **-3,226.85 KB (-36.70%)** | **-311.97 KB (-25.04%)** |

> [!NOTE]
> **Total Savings Across All 4 Libraries**:
> Over **3.22 Megabytes** (-36.70%) of redundant styles and duplicated CSS declarations eliminated from raw production bundles, delivering **-311.97 KB (-25.04%) in transfer-size Gzip reduction** across 252 web components.

---

## 📊 All Libraries Per Optimization Config

Marginal impact of each individual tool / config in isolation versus the combined total:

| Library | Optimization Tool / Config | Minified JS | Gzip Size | Brotli Size | Raw Impact (Δ) | Gzip Impact (Δ) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| **Carbon Web Components** | *Baseline* (Standard Vite) | 5,801.88 KB | 708.93 KB | 283.85 KB | — | — |
| Carbon Web Components | `cssFuse` (CSS AST Deduplication) | 2,761.95 KB | 419.47 KB | 281.65 KB | **-3,039.92 KB (-52.40%)** | **-289.46 KB (-40.83%)** |
| Carbon Web Components | `propsLower` (Lit Decorators & Props AOT) | 5,801.88 KB | 708.93 KB | 283.85 KB | — | — |
| Carbon Web Components | **TOTAL (All Optimizations Combined)** | **2,761.95 KB** | **419.47 KB** | **281.65 KB** | **-3,039.92 KB (-52.40%)** | **-289.46 KB (-40.83%)** |
| **Spectrum Web Components** | *Baseline* (Standard Vite) | 1,739.92 KB | 269.95 KB | 184.18 KB | — | — |
| Spectrum Web Components | `cssFuse` (CSS AST Deduplication) | 1,620.41 KB | 259.86 KB | 187.49 KB | **-119.51 KB (-6.87%)** | **-10.08 KB (-3.74%)** |
| Spectrum Web Components | `propsLower` (Lit Decorators & Props AOT) | 1,739.92 KB | 269.95 KB | 184.18 KB | — | — |
| Spectrum Web Components | **TOTAL (All Optimizations Combined)** | **1,620.41 KB** | **259.86 KB** | **187.49 KB** | **-119.51 KB (-6.87%)** | **-10.08 KB (-3.74%)** |
| **Web Awesome** | *Baseline* (Standard Vite) | 803.12 KB | 190.44 KB | 143.00 KB | — | — |
| Web Awesome | `cssFuse` (CSS AST Deduplication) | 739.19 KB | 177.74 KB | 135.39 KB | **-63.93 KB (-7.96%)** | **-12.69 KB (-6.67%)** |
| Web Awesome | `propsLower` (Lit Decorators & Props AOT) | 803.12 KB | 190.44 KB | 143.00 KB | — | — |
| Web Awesome | **TOTAL (All Optimizations Combined)** | **739.19 KB** | **177.74 KB** | **135.39 KB** | **-63.93 KB (-7.96%)** | **-12.69 KB (-6.67%)** |
| **Material Web** | *Baseline* (Standard Vite) | 448.37 KB | 76.63 KB | 58.46 KB | — | — |
| Material Web | `cssFuse` (CSS AST Deduplication) | 444.88 KB | 76.90 KB | 58.87 KB | **-3.49 KB (-0.78%)** | -0.27 KB (-0.35%) |
| Material Web | `propsLower` (Lit Decorators & Props AOT) | 448.37 KB | 76.63 KB | 58.46 KB | — | — |
| Material Web | **TOTAL (All Optimizations Combined)** | **444.88 KB** | **76.90 KB** | **58.87 KB** | **-3.49 KB (-0.78%)** | -0.27 KB (-0.35%) |

---

## 🔍 Granular Library Details

<details>
<summary><strong>1. Carbon Web Components (IBM Carbon Design System: 99 components)</strong> — Click to expand</summary>

### 📊 Detailed Breakdown: Carbon Web Components

| Optimization Tool / Mode | Minified JS | Gzip | Brotli | Raw Impact (Δ) | Gzip Impact (Δ) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| *Baseline* (Standard Vite) | 5,801.88 KB | 708.93 KB | 283.85 KB | — | — |
| `cssFuse` (CSS AST Deduplication) | 2,761.95 KB | 419.47 KB | 281.65 KB | **-3,039.92 KB (-52.40%)** | **-289.46 KB (-40.83%)** |
| `propsLower` (Lit Decorators & Props AOT) | 5,801.88 KB | 708.93 KB | 283.85 KB | — | — |
| **TOTAL (All Optimizations Combined)** | **2,761.95 KB** | **419.47 KB** | **281.65 KB** | **-3,039.92 KB (-52.40%)** | **-289.46 KB (-40.83%)** |

**AST & Deduplication Diagnostics**:
- **Rules Scanned**: 135,434 rules
- **Duplicate Rules Deduplicated**: 129,961 rules
- **Shared Constructable Sheets Created**: 205 modules
- **Component Chunks Rewritten**: 115 components

**Why the Massive Win (-52.40% / -3.04 MB)?**:
IBM Carbon compiles SCSS into `.scss.js` modules using `css([".cds--layer-one,:root{...}"])`. Every single component duplicated Carbon's ~80–100 KB base theme and layer tokens. By supporting `CallExpression` styles and extracting these shared blocks into constructable stylesheets, over 129,000 duplicate rules were collapsed into shared constructable sheets.

</details>

<details>
<summary><strong>2. Spectrum Web Components (Adobe Spectrum: 52 components)</strong> — Click to expand</summary>

### 📊 Detailed Breakdown: Spectrum Web Components

| Optimization Tool / Mode | Minified JS | Gzip | Brotli | Raw Impact (Δ) | Gzip Impact (Δ) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| *Baseline* (Standard Vite) | 1,739.92 KB | 269.95 KB | 184.18 KB | — | — |
| `cssFuse` (CSS AST Deduplication) | 1,620.41 KB | 259.86 KB | 187.49 KB | **-119.51 KB (-6.87%)** | **-10.08 KB (-3.74%)** |
| `propsLower` (Lit Decorators & Props AOT) | 1,739.92 KB | 269.95 KB | 184.18 KB | — | — |
| **TOTAL (All Optimizations Combined)** | **1,620.41 KB** | **259.86 KB** | **187.49 KB** | **-119.51 KB (-6.87%)** | **-10.08 KB (-3.74%)** |

**AST & Deduplication Diagnostics**:
- **Rules Scanned**: 14,046 rules
- **Duplicate Rules Deduplicated**: 14,195 rules
- **Shared Constructable Sheets Created**: 412 modules
- **Component Chunks Rewritten**: 536 components

**Why the Win (-119.51 KB)?**:
Spectrum isolates styles into `.css.js` files importing `import { css as o } from '@spectrum-web-components/base'`. With identifier alias tracking enabled, all minified tags (`o`, `s`, `t`) are extracted and shared `:host` resets, size variants, and typography scales are successfully fused across 52 component packages.

</details>

<details>
<summary><strong>3. Web Awesome (Full Suite: 73 elements)</strong> — Click to expand</summary>

### 📊 Detailed Breakdown: Web Awesome

| Optimization Tool / Mode | Minified JS | Gzip | Brotli | Raw Impact (Δ) | Gzip Impact (Δ) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| *Baseline* (Standard Vite) | 803.12 KB | 190.44 KB | 143.00 KB | — | — |
| `cssFuse` (CSS AST Deduplication) | 739.19 KB | 177.74 KB | 135.39 KB | **-63.93 KB (-7.96%)** | **-12.69 KB (-6.67%)** |
| `propsLower` (Lit Decorators & Props AOT) | 803.12 KB | 190.44 KB | 143.00 KB | — | — |
| **TOTAL (All Optimizations Combined)** | **739.19 KB** | **177.74 KB** | **135.39 KB** | **-63.93 KB (-7.96%)** | **-12.69 KB (-6.67%)** |

**AST & Deduplication Diagnostics**:
- **Rules Scanned**: 1,001 rules
- **Duplicate Rules Deduplicated**: 130 rules
- **Shared Constructable Sheets Created**: 28 modules
- **Component Chunks Rewritten**: 55 components

</details>

<details>
<summary><strong>4. Material Web (Google Material Design 3: 28 components)</strong> — Click to expand</summary>

### 📊 Detailed Breakdown: Material Web

| Optimization Tool / Mode | Minified JS | Gzip | Brotli | Raw Impact (Δ) | Gzip Impact (Δ) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| *Baseline* (Standard Vite) | 448.37 KB | 76.63 KB | 58.46 KB | — | — |
| `cssFuse` (CSS AST Deduplication) | 444.88 KB | 76.90 KB | 58.87 KB | **-3.49 KB (-0.78%)** | -0.27 KB (-0.35%) |
| `propsLower` (Lit Decorators & Props AOT) | 448.37 KB | 76.63 KB | 58.46 KB | — | — |
| **TOTAL (All Optimizations Combined)** | **444.88 KB** | **76.90 KB** | **58.87 KB** | **-3.49 KB (-0.78%)** | -0.27 KB (-0.35%) |

**AST & Deduplication Diagnostics**:
- **Rules Scanned**: 2,466 rules
- **Duplicate Rules Deduplicated**: 1,449 rules
- **Shared Constructable Sheets Created**: 137 modules
- **Component Chunks Rewritten**: 97 components

**Architectural Rationale for Lower Percentage**:
Material Design 3 web components use fine-grained component-scoped CSS custom properties (e.g. `--md-elevated-button-container-color`, `--md-filled-button-container-color`), which are uniquely named per element rather than sharing CSS classes. The remaining shared elevation and focus ring styles are deduplicated cleanly.

</details>

---

## 🛠️ Root-Cause Analysis & Fixes

When initially tested against libraries other than Web Awesome, Carbon and Spectrum showed 0 improvement and Material Web showed minor gains. The root causes and systemic fixes implemented:

| Library | Original Root Cause | Implemented Generalization Fix |
| :--- | :--- | :--- |
| **Carbon Web Components** | SCSS emitted as `var button_default = css([".cds..."])` (`CallExpression`), which was completely ignored by the visitor that only looked for `TaggedTemplateExpression`. | Added `extract_css_from_call` visiting `CallExpression` for array and string literal CSS arguments. Rewriter collapses shared arrays into constructable sheets. |
| **Spectrum Web Components** | Minified style imports (`import { css as o } from '@spectrum-web-components/base'`). Tag check strictly checked `ident.name == "css"`, rejecting `o`...``. | Added import scanner tracking all local aliases of `css` (`css_identifiers`), dynamically resolving `o`, `s`, `t` as valid Lit CSS template tags. |
| **Material Web** | Replaced styles with arrays `[fused_0, ...]` broke files doing `export default styles.styleSheet;` (`Array.styleSheet` is undefined). | Rewriter emits `CSSResult`-compatible replacements (single cluster reference or Lit `css` interpolation), ensuring `.styleSheet` remains valid across all components. |
| **Module Bloat** | Low-threshold micro-clustering created 150+ tiny virtual modules whose Rollup import overhead outweighed small CSS savings. | Added net-savings filtering in `fusion.rs` ensuring clusters are only created if net savings exceeds module import overhead. |

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

# Run a specific library
pnpm run benchmark:webawesome
node packages/benchmarks/src/index.js --suite=carbon
node packages/benchmarks/src/index.js --suite=spectrum
node packages/benchmarks/src/index.js --suite=material

# Output benchmark results as Markdown tables
pnpm run benchmark:markdown

# Test custom component suites or external libraries
node packages/benchmarks/src/index.js --entry=/path/to/app/main.js --include="/path/to/chunks/*.js"
```
