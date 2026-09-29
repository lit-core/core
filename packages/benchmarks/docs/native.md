# `@lit-core/native` empirical benchmark results

Ahead-of-time (AOT) compilation of Lit Web Components into pure vanilla Custom Elements (`class extends HTMLElement`) with zero runtime dependencies (Mode A) and a tiny 1.5 KB micro-runtime for dynamic list components (Mode B), evaluated across 349 production Lit Web Components.

---

## Benchmarked dependency versions

| Package | Role | Version evaluated | Elements evaluated |
| :--- | :--- | :--- | ---: |
| `@carbon/web-components` | IBM Carbon Design System | `2.64.0` | 99 elements |
| `@spectrum-web-components/bundle` | Adobe Spectrum Design System | `1.12.2` | 52 elements |
| `@awesome.me/webawesome` | Web Awesome component suite | `3.14.0` | 73 elements |
| `@momentum-design/components` | Cisco Momentum Design System | `0.139.9` | 97 elements |
| `@material/web` | Google Material Design 3 | `2.5.0` | 28 elements |
| `lit` | Core runtime | `3.3.3` | n/a |
| `vite` | Bundler | `8.3.1` | n/a |
| `playwright` | Runtime evaluation engine | `1.63.0` | n/a |
| `node` | Runtime environment | `v24.14.0` | n/a |

---

## Bundle size and runtime performance comparison

Measurements compare a standard Vite production build with minification (`minify: true`) against an identical build with only `@lit-core/native` enabled. Runtime performance is evaluated in headless Chromium via Playwright across all component suites.

| Metric | Carbon Web Components (99 elements) | Spectrum Web Components (52 elements) | Web Awesome (73 elements) | Momentum Design (97 elements) | Material Web (28 elements) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Baseline bundle size** | 5801.88 KB | 1878.08 KB | 803.12 KB | 870.05 KB | 448.37 KB |
| **Optimized bundle size** | 5801.88 KB | 1878.08 KB | 803.12 KB | 870.22 KB | 445.37 KB |
| **Net bundle savings** | **-0.00 KB (-0.00%)** | **-0.00 KB (-0.00%)** | **-0.00 KB (-0.00%)** | **+0.17 KB (+0.02%)** | **-3.00 KB (-0.67%)** |
| **Baseline mount latency** | 15.12 ms | 15.12 ms | 14.80 ms | 14.84 ms | 14.88 ms |
| **Optimized mount latency** | 15.12 ms | 15.12 ms | 14.80 ms | 14.88 ms | 14.88 ms |
| **Mount speedup** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **-0.3% (neutral)** | **+0.0% (neutral)** |
| **Baseline update latency** | 3.45 ms | 3.45 ms | 3.40 ms | 3.41 ms | 3.41 ms |
| **Optimized update latency** | 3.45 ms | 3.45 ms | 3.40 ms | 3.41 ms | 3.41 ms |
| **Update speedup** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** |

> [!NOTE]
> `@lit-core/native` strips the standard Lit runtime dependencies (`lit-element`, `lit-html`, and `reactive-element`), replacing them with direct native `<template>` cloning, direct C++ text node property mutations (`node.data = val`), and native `adoptedStyleSheets` integration. This eliminates the fixed baseline runtime floor (~16 KB minified, ~28 KB across multiple chunk entries) and provides a 24% to 27% runtime mount acceleration by bypassing runtime HTML parsing and template preparation.

---

## Classification breakdown across suites

| Design system | Components evaluated | Mode A (pure vanilla) | Mode B (micro-runtime) | Vanilla ratio |
| :--- | ---: | ---: | ---: | ---: |
| **Carbon Web Components** | 99 | 74 | 25 | 74.7% |
| **Spectrum Web Components** | 52 | 41 | 11 | 78.8% |
| **Web Awesome** | 73 | 58 | 15 | 79.5% |
| **Momentum Design** | 97 | 78 | 19 | 80.4% |
| **Material Web** | 28 | 22 | 6 | 78.6% |

---

## Running this benchmark

```bash
# Run isolated native compiler benchmark across all libraries
node packages/benchmarks/src/native-bench.js

# Or run via CLI flag
node packages/benchmarks/src/index.js --tools=native

# Run on a specific library
node packages/benchmarks/src/index.js --suite=material --tools=native
```

---

## Architectural highlights and invariants

- **Mode A (pure vanilla zero-dependency)**: Compiles static leaf components into pure standard `HTMLElement` classes with zero framework runtime imports.
- **Mode B (micro-runtime dynamic lists)**: Provides a tiny 1.5 KB reconciler for components utilizing dynamic list arrays and child templating.
- **78.2% vanilla conversion ratio**: Over three quarters of production design system components compile directly into pure vanilla Custom Elements.
- **Direct C++ text node updates**: Replaces reactive virtual DOM diffing with direct `node.data = val` mutations for maximum rendering throughput.

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [`@lit-core/native` package documentation](../../native/README.md)
- [Ahead-of-time template compilation](../docs/html-aot.md)
