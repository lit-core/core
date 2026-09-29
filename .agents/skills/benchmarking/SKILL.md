---
name: benchmarking
description: >-
  Execute, analyze, and format bundle size and deduplication benchmarks for lit-core.
  Use when running benchmarks across Carbon, Spectrum, Web Awesome, Material Web, or Momentum,
  comparing optimization impacts, or inspecting JSON outputs and the React benchmark viewer.
---

# Benchmark execution and reporting guide

This skill guides you through running, analyzing, and inspecting benchmarks in `@lit-core/benchmarks`.

## Available suites and canonical component parity

To guarantee fair, consistent benchmarks, each suite evaluates an identical set of **20 canonical UI components** representing an enterprise dashboard:
- `carbon`: `@carbon/web-components` (IBM Carbon, 20 canonical components)
- `spectrum`: `@spectrum-web-components` (Adobe Spectrum, 20 canonical components)
- `webawesome`: `@awesome.me/webawesome` (Web Awesome, 20 canonical components)
- `material`: `@material/web` (Google Material Web, 20 canonical components)
- `momentum`: `@momentum-design/components` (Cisco Momentum Design, 20 canonical components)

Canonical component mapping is defined in `packages/benchmarks/src/suites/canonical-components.js`.

---

## Strict benchmark invariant: real enterprise components only (never mocks or toy strings)

Every benchmark in `@lit-core/benchmarks`—whether whole-bundle Vite builds, per-tool isolation runs, or standalone microbenchmarks—must evaluate actual production component sources, real stylesheets, and real custom element instances directly from the 5 designated libraries in `node_modules`:
- IBM Carbon Web Components (`@carbon/web-components`)
- Adobe Spectrum Web Components (`@spectrum-web-components`)
- Web Awesome (`@awesome.me/webawesome`)
- Google Material Web (`@material/web`)
- Cisco Momentum Design (`@momentum-design/components`)

**Strictly forbidden**:
- Mock component definitions (e.g. `elem-${i}`, `mock-button`, or hand-rolled `HTMLElement` stubs in VM contexts).
- Synthetic math loops or theoretical multipliers (e.g. `Math.sqrt(i)` to simulate CPU load).
- Fabricated fallback arithmetic or hardcoded speedup constants.
- Generic HTML elements (`<div><span>Item</span></div>`) substituted in place of the bundle's actual custom elements.

---

## Execution commands

Every feature and baseline has standalone execution support:

```bash
# Run standalone benchmark for a specific library and tool
node packages/benchmarks/src/index.js --suite=carbon --tool=baseline
node packages/benchmarks/src/index.js --suite=carbon --tool=css-fuse
node packages/benchmarks/src/index.js --suite=carbon --tool=html-aot

# Run all features for a single design system
pnpm run benchmark:carbon
pnpm run benchmark:spectrum
pnpm run benchmark:webawesome
pnpm run benchmark:material
pnpm run benchmark:momentum

# Run a specific feature across all design systems
node packages/benchmarks/src/index.js --tool=css-fuse
node packages/benchmarks/src/index.js --tool=props-lower
node packages/benchmarks/src/index.js --tool=all

# Run all suites in sequence
pnpm run benchmark:all
```

---

## Standalone JSON artifacts

Every benchmark run produces decoupled standalone outputs in `packages/benchmarks/results/`:
- `results/manifest.json`: Index manifest recording all libraries, features, and executed run metrics.
- `results/<suite>/<feature>.json`: Pure quantitative metrics and AST diagnostics (schema 2.0.0).

---

## Interactive React benchmark viewer dashboard

The React application in `packages/benchmarks/viewer` provides visual exploration with strictly zero bundled or hardcoded data:

```bash
# Launch development viewer server
pnpm run viewer:dev

# Build static production dashboard for GitHub Pages deployment
pnpm run viewer:build

# Preview static production dashboard locally
pnpm run viewer:preview
```

---

## Writing and casing rules

1. **Sentence case rule (strictly mandatory)**:
   - Always use sentence case for markdown headings (`#`, `##`, `###`), table headers, bullet items, and descriptions.
   - Never use Title Case for headers or labels.
   - Preserve code identifiers and brand names (`Lit`, `Vite`, `AST`, `Rollup`, `HTML`, `CSSStyleSheet`, `oxc`, `lightningcss`, `Carbon Web Components`, `GitHub Pages`).
2. **Strictly no em dashes**:
   - Use `-` or `n/a` instead of `—` or `--`.
