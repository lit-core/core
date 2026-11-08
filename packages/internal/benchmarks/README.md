# @lit-core/benchmarks

> Empirical bundle size, build duration, and runtime performance benchmarks for `@lit-core` across production Lit design systems.

---

## Introduction

### What is it?

`@lit-core/benchmarks` is an empirical benchmarking harness and interactive dashboard that evaluates `@lit-core` compiler optimizations against standard Vite production builds across 5 major enterprise Web Component design systems.

### Why does it exist?

Compiler benchmarks often rely on artificial hello-world examples or synthetic counter widgets that fail to simulate production enterprise workloads. Real component libraries (such as IBM Carbon, Adobe Spectrum, Web Awesome, Material Web, and Cisco Momentum) feature complex CSS encapsulation, deep Shadow DOM hierarchies, extensive reactive state pipelines, and large vendor footprints.

To provide credible, reproducible performance metrics, `@lit-core/benchmarks` measures:
- Exact raw, gzip, and brotli bundle byte savings.
- Compiler pass overhead and build durations.
- Headless browser first render mount latency.
- Microtask reactive update and reconciliation speedups.

### How does it work?

The harness evaluates a standardized suite of **20 canonical UI components** resolved directly from published npm packages:
1. **Build matrix**: Executes isolated Vite builds for each optimization pass as well as combined suites, comparing them against an untouched production baseline.
2. **Browser measurement**: Boots headless Chromium via Playwright, mounts the compiled components in isolated DOM containers, and records high-resolution performance timings (`performance.now()`).
3. **Structured data emission**: Writes structured JSON artifacts to `packages/internal/benchmarks/results/`.
4. **Interactive exploration**: Renders all results in a React-based viewer dashboard featuring heatmap matrices, library deep-dives, and JSON inspection.

---

## Architecture

```mermaid
flowchart TD
    A["5 Enterprise design systems: Carbon, Spectrum, Web Awesome, Material, Momentum"] --> B["Canonical 20-component resolver"]
    B --> C["Vite bundling pipeline: Baseline vs @lit-core optimization passes"]
    C --> D["Bundle size analysis: raw, gzip, brotli"]
    C --> E["Playwright headless Chromium runner"]
    E --> F["Runtime metrics: first render latency & reactive update speed"]
    D & F --> G["JSON artifact emitter: results/<suite>/<tool>.json"]
    G --> H["Interactive React benchmark viewer dashboard"]
```

### Technical details

#### 1. Canonical component parity architecture

To ensure an apples-to-apples evaluation across different design systems, benchmarks test an identical set of 20 canonical UI components representing a full-featured enterprise application:

`button`, `checkbox`, `radio`, `switch`, `text-input`, `select`, `dialog`, `badge`, `tabs`, `progress-bar`, `spinner`, `slider`, `menu`, `divider`, `icon`, `icon-button`, `card`, `avatar`, `accordion`, and `breadcrumb`.

Every component is resolved from production package exports, guaranteeing uniform test surface across all suites.

#### 2. Dual-tier benchmark methodology

1. **Static leaf bundle matrix (`results/manifest.json`)**:
   - Evaluates the 20 atomic UI components bundled together in client applications.
   - Measures bundle size reduction, decorator lowering, and CSS deduplication.
2. **Dynamic scenario benchmarks (`results/scenarios/`)**:
   - Evaluates optimizations within their authentic execution environments:
     - **Data grid (`data-grid`)**: Evaluates `memoize` and `dom-paths` on high-frequency collection re-renders and sorting/filtering pipelines.
     - **SSR resumption (`ssr-dashboard`)**: Evaluates `resumable` against pre-rendered Declarative Shadow DOM markup with interaction-driven hydration.
     - **Interactive form (`interactive-form`)**: Evaluates `event-hoist` and `elem-proxy` across controls with delegated event dispatch.
     - **Design system suite (`bundle`)**: Evaluates `css-fuse` and minification across entire multi-component libraries.

#### 3. Evaluated optimization passes

| Optimization pass | Primary mechanism                                                            |
| :---------------- | :--------------------------------------------------------------------------- |
| `css-fuse`        | Cross-component CSS AST deduplication into constructable sheets              |
| `props-lower`     | Lowers `@property` / `@state` decorators to static class `properties`        |
| `html-fuse`       | Clusters repeated static HTML and SVG subtrees into shared constants         |
| `directives`      | Ahead-of-time lowering of built-in Lit directives, pruning runtime imports   |
| `memoize`         | Auto-memoizes pure array pipelines (`.map()`, `.filter()`) in `render()`     |
| `dom-paths`       | Replaces `TreeWalker` mounting traversal with direct child pointers          |
| `event-hoist`     | ShadowRoot event delegation with composed path dispatch                      |
| `dirty-mask`      | Property-to-part dependency bitmasking with `noChange` short-circuiting      |
| `elem-proxy`      | Deferred proxy stubs and JIT Custom Element class upgrade                    |
| `html-aot`        | Ahead-of-time Lit template compilation into static descriptors               |
| `native`          | Compiles leaf components into zero-dependency vanilla `HTMLElement` classes  |
| `css-minifier`    | Embedded CSS template literal minification via `lightningcss`                |
| `html-minifier`   | Embedded HTML template literal minification via `oxc`                        |
| `tag-shake`       | Ahead-of-time Custom Element registration dead code elimination              |
| `resumable`       | Declarative Shadow DOM SSR with interaction-driven resumption                |
| `ssr` / `edge`    | Universal Declarative Shadow DOM streaming and `HTMLRewriter` edge rendering |
| `all`             | Complete `@lit-core` optimization suite combined                             |

---

## Running benchmarks

### Standalone commands

```bash
# Run standalone benchmark for a specific library and tool
node packages/internal/benchmarks/src/index.js --suite=carbon --tool=baseline
node packages/internal/benchmarks/src/index.js --suite=carbon --tool=css-fuse
node packages/internal/benchmarks/src/index.js --suite=carbon --tool=html-aot

# Run all features for a single design system
pnpm run benchmark:carbon
pnpm run benchmark:spectrum
pnpm run benchmark:webawesome
pnpm run benchmark:material
pnpm run benchmark:momentum

# Run a specific feature across all design systems
node packages/internal/benchmarks/src/index.js --tool=css-fuse
node packages/internal/benchmarks/src/index.js --tool=props-lower
node packages/internal/benchmarks/src/index.js --tool=all

# Run the complete benchmark matrix across all libraries and tools
pnpm run benchmark:all
```

---

## Interactive React benchmark viewer

All benchmark results can be explored interactively via the React viewer application:

```bash
# Start the interactive benchmark viewer in development mode
pnpm run viewer:dev

# Build the static production viewer with relative paths for GitHub Pages
pnpm run viewer:build

# Preview the static production build locally
pnpm run viewer:preview
```

### Dashboard capabilities

- **Overview matrix**: Cross-library heatmap table comparing all 5 design systems against all optimization features.
- **Library deep dive**: Filter by design system, inspecting baseline bundle size vs each optimization delta with visual charts.
- **Feature deep dive**: Inspect a specific compiler pass across all 5 libraries alongside AST diagnostics.
- **Tested components**: Comprehensive cross-library mapping table of all 20 canonical UI concepts and their respective custom element tags.
- **Raw JSON inspector**: Formatted JSON inspection for every standalone benchmark output with copy and download utilities.
- **Zero bundled data**: Loads metrics dynamically via runtime `fetch('./results/manifest.json')` and `fetch('./results/<suite>/<feature>.json')` with strictly zero hardcoded data.

---

## Cross references

- Real component Playwright test suite: [`@lit-core/tests`](../tests/README.md)
- Multi-framework component showcase: [`@lit-core/showcase`](../showcase/README.md)
- Root repository documentation: [Monorepo README](../../../README.md)

---

## License

MIT
