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
- Special-casing compiler transforms to make benchmarks look favorable. Benchmarks objectively measure compiler performance across real-world code.
- Hiding bailouts: if a component bails out because an unsupported feature is encountered, report the bailout transparently. Never inject fake runtime stubs to artificially inflate benchmark metrics.

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

# Real-world scenario-based benchmarks
pnpm run benchmark:scenario:grid    # Data grid (1,000 cells: dom-paths, dirty-mask, native)
pnpm run benchmark:scenario:form    # Interactive form (500 controls: event-hoist, elem-proxy)
pnpm run benchmark:scenario:ssr     # Server-rendered dashboard (resumable, html-aot)
pnpm run benchmark:scenario:bundle  # Design system bundle (css-fuse, css-minifier, props-lower)
pnpm run benchmark:scenarios        # Run all 4 scenarios across design systems

# Run a specific scenario and variant
node packages/benchmarks/src/index.js --scenario=data-grid --suite=carbon --variant=dom-paths
node packages/benchmarks/src/index.js --scenario=interactive-form --suite=carbon --variant=event-hoist
```

---

## Real-world production scenarios

Each compiler optimization is evaluated in its genuine production use case:

1. **Data grid or table (1,000 cells)**:
   - Evaluates `dom-paths`, `dirty-mask`, `native`, `memoize` (secondary: `html-aot`).
   - Renders 1,000 canonical component cells (`badge`, `button`, `checkbox`, `icon-button`) using keyed `repeat`.
   - Directly measures TreeWalker overhead during batch mounting, single-cell reactive updates, column updates, and keyed row reordering.
2. **Interactive form or dense list (500 controls)**:
   - Evaluates `event-hoist`, `elem-proxy` (secondary: `dirty-mask`).
   - Renders 500 controls with event listeners (50 above fold, 450 below fold).
   - Directly measures DOM event listener allocations via CDP, interaction latency via real Playwright mouse and keyboard events, and deferred element upgrade latency.
3. **Server-rendered landing page or dashboard**:
   - Evaluates `resumable`, `html-aot`.
   - Pre-rendered Declarative Shadow DOM HTML with inline resumption micro-loader.
   - Directly measures First Contentful Paint (FCP), Total Blocking Time (TBT), initial JS payload (< 2 KB), and resumption latency upon first user click.
4. **Multi-component bundle (entire design system suite)**:
   - Evaluates `css-fuse`, `css-minifier`, `html-minifier`, `props-lower`.
   - Enterprise application importing all 20 canonical components with 3 code-split routes.
   - Directly measures cross-component style deduplication into shared constructable `CSSStyleSheet` objects, chunk scoping, and decorator lowering.

---

## Scenario JSON artifacts (schema 3.0.0)

Scenario results are persisted to `packages/benchmarks/results/scenarios/<scenario>/<suite>/<variant>.json`:
- `schemaVersion`: `3.0.0`
- `scenario`: identifier and metadata
- `metrics`: raw build sizes, timings, DOM counters, and observer metrics
- `deltas`: difference vs baseline, 95% bootstrap confidence interval, and noise detection
- `equivalence`: verified DOM structure and shadow tree equivalence check

---

## Standalone JSON artifacts

Every benchmark run produces decoupled standalone outputs in `packages/benchmarks/results/`:
- `results/manifest.json`: Index manifest recording all libraries, features, and executed run metrics.
- `results/<suite>/<feature>.json`: Pure quantitative metrics and AST diagnostics (schema 2.0.0).

---

## Measured performance metrics

Runtime metrics recorded in `results/manifest.json` and `results/<suite>/<feature>.json`:
- `firstRenderMs` and `speedupPercent`: First-render mount latency across 50 component instances.
- `updateMs` and `updateSpeedupPercent`: Reactive property update latency across 50 component instances.
- `scriptEvalMs` and `evalSpeedupPercent`: Execution time for the bundled code.
- `registrationMs`: Cumulative execution time spent inside `customElements.define`.
- `heapUsedBytes` and `memorySavingsPercent`: Retained heap memory delta before and after mounting 50 component instances.

When running in headless or sandboxed environments where browser APIs or Chromium are unavailable, missing runtime metrics default to 0 (unmeasured) rather than synthetic values.

---

## Interactive React benchmark viewer dashboard

The React application in `packages/benchmarks/viewer` provides visual exploration with strictly zero bundled or hardcoded data:

```bash
# Launch development viewer server
pnpm run viewer:dev

# Build static production dashboard for GitHub Pages deployment
pnpm run viewer:build

### UI typography and visual design rules for the viewer
- **Strict sentence case**: Zero `uppercase` CSS transforms, no Title Case in headings, buttons, tabs, or badges.
- **Root 16px and 1rem floor**: Minimum 1rem (`text-base`, 16px) everywhere; strictly forbid `text-xs` (12px) and `text-sm` (14px).
- **Thinner font weights**: Use `font-light` (300) for secondary copy, `font-normal` (400) for body and values, and `font-medium` (500) only for titles and active pills. No heavy bold weights.
- **Wide container alignment**: Both header and content share `w-full max-w-[1600px] mx-auto px-6 sm:px-10 lg:px-14`.
- **Headings outside cards**: Section headings sit cleanly on the canvas outside and above white surface cards.
- **Flat borderless design**: Zero 1px borders (`border-none`), subtle surface contrast on `#fafafb` canvas.
- For complete specifications, see `ui-typography-and-design`.

---

## Writing and casing rules

1. **Sentence case rule (strictly mandatory)**:
   - Always use sentence case for markdown headings (`#`, `##`, `###`), table headers, bullet items, and descriptions.
   - Never use Title Case for headers or labels.
   - Preserve code identifiers and brand names (`Lit`, `Vite`, `AST`, `Rollup`, `HTML`, `CSSStyleSheet`, `oxc`, `lightningcss`, `Carbon Web Components`, `GitHub Pages`).
2. **Strictly no em dashes**:
   - Use `-` or `n/a` instead of `—` or `--`.
