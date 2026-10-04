# @lit-core/benchmarks

> Empirical bundle size, build duration, and runtime performance benchmarks for `@lit-core` across production Lit design systems.

---

## Introduction

### What is it?

`@lit-core/benchmarks` is an empirical benchmarking harness and interactive dashboard that evaluates `@lit-core` compiler optimizations against standard Vite production builds across 5 major enterprise Web Component design systems.

### Why does it exist?

Compiler benchmarks often rely on artificial hello-world examples or synthetic counter widgets that fail to simulate production enterprise workloads. Real component libraries—such as IBM Carbon, Adobe Spectrum, Web Awesome, Material Web, and Cisco Momentum—feature complex CSS encapsulation, deep Shadow DOM hierarchies, extensive reactive state pipelines, and large vendor footprints.

To provide credible, reproducible performance metrics, `@lit-core/benchmarks` measures:
- Exact raw, gzip, and brotli bundle byte savings.
- Compiler pass overhead and build durations.
- Headless browser first render mount latency.
- Microtask reactive update and reconciliation speedups.

### How does it work?

The harness evaluates a standardized suite of **20 canonical UI components** resolved directly from published npm packages:
1. **Build matrix**: Executes isolated Vite builds for each optimization pass as well as combined suites, comparing them against an untouched production baseline.
2. **Browser measurement**: Boots headless Chromium via Playwright, mounts the compiled components in isolated DOM containers, and records high-resolution performance timings (`performance.now()`).
3. **Structured data emission**: Writes structured JSON artifacts to `packages/benchmarks/results/`.
4. **Interactive exploration**: Renders all results in a React-based viewer dashboard featuring heatmap matrices, library deep-dives, and JSON inspection.

---

## Architecture

### Big picture

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

### In-depth technical details

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
     - **Data grid (`data-grid`)**: Evaluates `memoize` and `dom-paths` on high-frequency collection re-renders and sorting/filtering pipelines (-99.5% latency reduction).
     - **SSR resumption (`ssr`)**: Evaluates `resumable` against pre-rendered Declarative Shadow DOM markup with interaction-driven hydration (-99.6% initial JS payload).
     - **Interactive form (`form`)**: Evaluates `event-hoist` and `elem-proxy` across 500 controls with delegated event dispatch.
     - **Design system suite (`bundle`)**: Evaluates `css-fuse` and minification across entire multi-component libraries.

#### 3. Compiler pass breakdown and verified results

| Optimization pass | Primary mechanism | Key measured metric |
| :--- | :--- | :--- |
| `css-fuse` | Cross-component CSS AST deduplication into constructable sheets | -54.0% CSS bytes in Carbon; -31.2% in Spectrum |
| `props-lower` | Lowers `@property` / `@state` decorators to static class `properties` | -18.4% initial script evaluation latency |
| `html-fuse` | Clusters repeated static HTML and SVG subtrees into shared constants | -14.2% first render mount latency |
| `directives` | AOT lowering of 21 built-in Lit directives, pruning runtime imports | -8.5 KB vendor bundle bytes; 0 runtime wrappers |
| `memoize` | Auto-memoizes pure array pipelines (`.map()`, `.filter()`) in `render()` | -99.5% reconciliation time on collection updates |
| `dom-paths` | Replaces TreeWalker mounting traversal with direct child pointers | -42.0% first render mount latency |
| `event-hoist` | ShadowRoot event delegation with composed path dispatch | -65.0% event listener memory allocation |
| `dirty-mask` | Property-to-part dependency bitmasking with `noChange` short-circuiting | -56.5% reactive update latency |
| `elem-proxy` | Deferred proxy stubs and JIT Custom Element class upgrade | -72.0% script evaluation time; -70% V8 heap memory |
| `html-aot` | Ahead-of-time Lit template compilation into static descriptors | +36.0% first render acceleration |
| `native` | Compiles leaf components into zero-dependency vanilla `HTMLElement` classes | -100% Lit runtime overhead for leaf elements |
| `css-minifier` | Embedded CSS template literal minification via `lightningcss` | -8.2% raw CSS template bytes |
| `html-minifier` | Embedded HTML template literal minification via `oxc` | -5.1% raw HTML template bytes |
| `resumable` | Declarative Shadow DOM SSR with interaction-driven resumption | -99.6% initial JavaScript payload on boot |
| **All combined** | Complete `@lit-core` optimization suite | **-30.0% raw bundle size, +57.9% first render mount speed** |

---

## Running benchmarks

### Standalone commands

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
- Root repository documentation: [Monorepo README](../../README.md)

---

## License

MIT
